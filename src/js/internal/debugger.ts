import type { ServerWebSocket, Socket, WebSocketHandler, Server as WebSocketServer } from "bun";
import type { InspectorCDPAdapter } from "./inspector/cdp";
const enum FramerState {
  WaitingForLength,
  WaitingForMessage,
}

let socketFramerMessageLengthBuffer: Buffer;
class SocketFramer {
  state: FramerState = FramerState.WaitingForLength;
  pendingLength: number = 0;
  sizeBuffer: Buffer = Buffer.alloc(4);
  sizeBufferIndex: number = 0;
  bufferedData: Buffer = Buffer.alloc(0);

  constructor(private onMessage: (message: string | string[]) => void) {
    if (!socketFramerMessageLengthBuffer) {
      socketFramerMessageLengthBuffer = Buffer.alloc(4);
    }
    this.reset();
  }

  reset(): void {
    this.state = FramerState.WaitingForLength;
    this.bufferedData = Buffer.alloc(0);
    this.sizeBufferIndex = 0;
    this.sizeBuffer = Buffer.alloc(4);
  }

  send(socket: Socket<{ framer: SocketFramer; backend: Backend }>, data: string): void {
    if (!!$debug) {
      $debug("local:", data);
    }

    socketFramerMessageLengthBuffer.writeUInt32BE(Buffer.byteLength(data), 0);
    socket.$write(socketFramerMessageLengthBuffer);
    socket.$write(data);
  }

  onData(socket: Socket<{ framer: SocketFramer; backend: Writer }>, data: Buffer): void {
    this.bufferedData = this.bufferedData.length > 0 ? Buffer.concat([this.bufferedData, data]) : data;

    let messagesToDeliver: string[] = [];

    while (this.bufferedData.length > 0) {
      if (this.state === FramerState.WaitingForLength) {
        const bufferedLength = this.bufferedData.length;
        if (this.sizeBufferIndex + bufferedLength < 4) {
          const remainingBytes = Math.min(4 - this.sizeBufferIndex, bufferedLength);
          this.bufferedData.copy(this.sizeBuffer, this.sizeBufferIndex, 0, remainingBytes);
          this.sizeBufferIndex += remainingBytes;
          this.bufferedData = this.bufferedData.slice(remainingBytes);
          break;
        }

        const remainingBytes = 4 - this.sizeBufferIndex;
        this.bufferedData.copy(this.sizeBuffer, this.sizeBufferIndex, 0, remainingBytes);
        this.pendingLength = this.sizeBuffer.readUInt32BE(0);

        this.state = FramerState.WaitingForMessage;
        this.sizeBufferIndex = 0;
        this.bufferedData = this.bufferedData.slice(remainingBytes);
      }

      if (this.bufferedData.length < this.pendingLength) {
        break;
      }

      const message = this.bufferedData.toString("utf-8", 0, this.pendingLength);
      this.bufferedData = this.bufferedData.slice(this.pendingLength);
      this.state = FramerState.WaitingForLength;
      this.pendingLength = 0;
      this.sizeBufferIndex = 0;
      messagesToDeliver.push(message);
    }

    if (!!$debug) {
      $debug("remote:", messagesToDeliver);
    }

    if (messagesToDeliver.length === 1) {
      this.onMessage(messagesToDeliver[0]);
    } else if (messagesToDeliver.length > 1) {
      this.onMessage(messagesToDeliver);
    }
  }
}

interface Backend {
  write: (message: string | string[]) => boolean;
  close: () => void;
}

type CreateBackendFn = (
  executionContextId: number,
  refEventLoop: boolean,
  receive: (...messages: string[]) => void,
  isCDP?: boolean,
  preventShutdown?: boolean,
) => unknown;

// CDP translation is only needed for node:inspector servers, so load it lazily.
let lazyInspectorCDPAdapter: any;
// JSC's FrontendRouter broadcasts responses to every frontend, so backend command ids must be
// disjoint across all adapters: JSC frontends count from 1, remote CDP from 50M, in-process
// Session from 100M (inspector.ts). https://github.com/WebKit/WebKit/tree/main/Source/JavaScriptCore/inspector/protocol
let nextRemoteBackendId = 50_000_000;
function allocateRemoteBackendId() {
  const id = nextRemoteBackendId++;
  if (nextRemoteBackendId >= 100_000_000) nextRemoteBackendId = 50_000_000;
  return id;
}

function discardSessionClientMessage() {}

function cdpAdapterConstructor() {
  return (lazyInspectorCDPAdapter ??= require("internal/inspector/cdp").InspectorCDPAdapter);
}

export default function (
  executionContextId: number,
  url: string,
  createBackend: CreateBackendFn,
  send: (message: string | string[]) => void,
  close: () => void,
  isAutomatic: boolean,
  urlIsServer: boolean,
  isNodeInspector: boolean,
  reportNodeInspectorServerStarted: (url: string, controlCallback?: (message: string) => void, error?: string) => void,
  enableNodeCDP: boolean,
  isWaitingForDebuggerFor: (executionContextId: number) => boolean,
  isAcceptingConnectionsFor: (executionContextId: number) => boolean,
): void {
  const isWaitingForDebugger = isWaitingForDebuggerFor.bind(undefined, executionContextId);
  const isAcceptingConnections = isAcceptingConnectionsFor.bind(undefined, executionContextId);
  if (urlIsServer) {
    connectToUnixServer(executionContextId, url, createBackend, send, close);
    return;
  }

  if (isNodeInspector) {
    // inspector.open(): CDP connections, URL reported back, control callback for close/forward.
    // https://github.com/nodejs/node/blob/main/lib/inspector.js
    let debug: Debugger | undefined;
    let sessionBackend: Backend | undefined;
    let sessionAdapter: any;
    let sessionRefs = 0;
    const control = (message: string) => {
      let parsed: any;
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }
      switch (parsed?.type) {
        case "close":
          try {
            sessionBackend?.close();
            sessionBackend = undefined;
            sessionAdapter?.handleClientDisconnect();
            sessionAdapter = undefined;
            sessionRefs = 0;
            debug?.stop();
            debug = undefined;
          } finally {
            // inspector.close() blocks until this lands: the port must already
            // be refused when close() returns. Signalled from a finally so a
            // failing stop() cannot hang the inspected thread forever.
            reportNodeInspectorServerStarted("", control, undefined);
          }
          return;
        case "session-connect":
          sessionRefs++;
          return;
        case "session-disconnect":
          // Last in-process Session that forwarded Debugger.* commands has
          // disconnected: release the shared backend so its breakpoints don't
          // outlive it. Refcounted so one Session can't tear down another's.
          if (--sessionRefs > 0) return;
          sessionRefs = 0;
          sessionBackend?.close();
          sessionBackend = undefined;
          sessionAdapter?.handleClientDisconnect();
          sessionAdapter = undefined;
          return;
        case "open": {
          // inspector.open() after inspector.close() or after a failed start:
          // start a new server on this already-running debugger thread and
          // report its URL back.
          try {
            debug = new Debugger(
              executionContextId,
              parsed.url,
              createBackend,
              send,
              close,
              true,
              false,
              isWaitingForDebugger,
              isAcceptingConnections,
            );
            reportNodeInspectorServerStarted(debug.url!.href, control, undefined);
          } catch (error) {
            reportNodeInspectorServerStarted("", control, nodeInspectorListenErrorDetail(error));
          }
          return;
        }
        case "command": {
          // CDP command forwarded from in-process inspector.Session (fire-and-forget; responses
          // stay here). https://github.com/nodejs/node/blob/main/lib/inspector.js
          if (!debug) return;
          if (!sessionAdapter) {
            let adapter: any;
            function handleSessionBackendMessages(...messages: string[]) {
              for (const backendMessage of messages) {
                adapter.handleBackendMessage(backendMessage);
              }
            }
            function writeSessionCommandToBackend(backendMessage: string) {
              void sessionBackend?.write(backendMessage);
            }
            sessionBackend = debug.createSessionBackend(handleSessionBackendMessages);
            adapter = new (cdpAdapterConstructor())(
              writeSessionCommandToBackend,
              discardSessionClientMessage,
              allocateRemoteBackendId,
              isWaitingForDebugger,
            );
            sessionAdapter = adapter;
            sessionAdapter.handleClientMessage(JSON.stringify({ id: 0, method: "Debugger.enable", params: {} }));
          }
          sessionAdapter.handleClientMessage(
            JSON.stringify({ id: parsed.id ?? 0, method: parsed.method, params: parsed.params ?? {} }),
          );
          return;
        }
      }
    };

    try {
      debug = new Debugger(
        executionContextId,
        url,
        createBackend,
        send,
        close,
        true,
        false,
        isWaitingForDebugger,
        isAcceptingConnections,
      );
    } catch (error) {
      // Register the control callback even though the server failed to start
      // (e.g. the port is in use), so a later inspector.open() can retry with
      // an "open" control message on this already-running debugger thread.
      reportNodeInspectorServerStarted("", control, nodeInspectorListenErrorDetail(error));
      return;
    }

    reportNodeInspectorServerStarted(debug.url!.href, control, undefined);
    return;
  }

  let debug: Debugger | undefined;
  try {
    debug = new Debugger(
      executionContextId,
      url,
      createBackend,
      send,
      close,
      false,
      enableNodeCDP,
      isWaitingForDebugger,
      isAcceptingConnections,
    );
  } catch (error) {
    exit("Failed to start inspector:\n", error);
  }

  // If the user types --inspect, we print the URL to the console.
  // If the user is using an editor extension, don't print anything.
  if (!isAutomatic) {
    const debugUrl = debug.url;
    if (debugUrl) {
      const { protocol, href, host, pathname } = debugUrl;
      if (!protocol.includes("unix")) {
        Bun.write(Bun.stderr, dim("--------------------- Bun Inspector ---------------------") + reset() + "\n");
        Bun.write(Bun.stderr, `Listening:\n  ${dim(href)}\n`);
        if (protocol.includes("ws")) {
          Bun.write(Bun.stderr, `Inspect in browser:\n  ${link(`https://debug.bun.sh/#${host}${pathname}`)}\n`);
        }
        Bun.write(Bun.stderr, dim("--------------------- Bun Inspector ---------------------") + reset() + "\n");
        const cdpUrl = debug.cdpUrl;
        if (cdpUrl) {
          Bun.write(
            Bun.stderr,
            `Debugger listening on ${cdpUrl}\nFor help, see: https://nodejs.org/learn/getting-started/debugging\n`,
          );
        }
      }
    } else {
      Bun.write(Bun.stderr, dim("--------------------- Bun Inspector ---------------------") + reset() + "\n");
      Bun.write(Bun.stderr, `Listening on ${dim(url)}\n`);
      Bun.write(Bun.stderr, dim("--------------------- Bun Inspector ---------------------") + reset() + "\n");
    }
  }

  const notifyUrl = process.env["BUN_INSPECT_NOTIFY"] || "";
  if (notifyUrl) {
    // Only send this once.
    process.env["BUN_INSPECT_NOTIFY"] = "";

    if (notifyUrl.startsWith("unix://")) {
      const path = require("node:path");
      notify({
        // This is actually a filesystem path, not a URL.
        unix: path.resolve(notifyUrl.substring("unix://".length)),
      });
    } else {
      const { hostname, port } = new URL(notifyUrl);
      notify({
        hostname,
        port: port && port !== "0" ? Number(port) : undefined,
      });
    }
  }
}

// Node prints the libuv one-liner ("address already in use"), not the full
// Bun.serve message, in "Starting inspector on ... failed:".
function nodeInspectorListenErrorDetail(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "EADDRINUSE") return "address already in use";
  if (code === "EACCES") return "permission denied";
  return `${(error as Error)?.message ?? error}`;
}

function unescapeUnixSocketUrl(href: string) {
  if (href.startsWith("unix://%2F")) {
    return decodeURIComponent(href.substring("unix://".length));
  }

  return href;
}

class BackendHandle {
  #backend;
  #send;
  #close;

  constructor(backend: unknown, send: (message: string | string[]) => void, close: () => void) {
    this.#backend = backend;
    this.#send = send;
    this.#close = close;
  }

  write(message: string | string[]) {
    this.#send.$call(this.#backend, message);
    return true;
  }

  close() {
    this.#close.$call(this.#backend);
  }
}

class Debugger {
  #url?: URL;
  #backendFactory: CreateBackendFn;
  #backendSend: (message: string | string[]) => void;
  #backendClose: () => void;
  #executionContextId: number;

  #createBackend(
    refEventLoop: boolean,
    receive: (...messages: string[]) => void,
    isCDP = false,
    preventShutdown = false,
  ): Backend {
    const backend = this.#backendFactory(this.#executionContextId, refEventLoop, receive, isCDP, preventShutdown);
    return new BackendHandle(backend, this.#backendSend, this.#backendClose);
  }
  // node:inspector mode: connections speak the V8 Chrome DevTools Protocol and
  // /json discovery endpoints are served.
  #nodeInspector = false;
  #cdpPathname?: string;
  #cdpHost?: string;
  #enableNodeCDP = false;
  #isWaitingForDebugger: () => boolean;
  #isAcceptingConnections: () => boolean;
  #disconnectNotify: { handshakeStarted: boolean; retaining: number; adapters: Set<InspectorCDPAdapter> | undefined } =
    {
      handshakeStarted: false,
      retaining: 0,
      adapters: undefined,
    };
  #server?: WebSocketServer;
  #loopbackServer?: WebSocketServer;

  constructor(
    executionContextId: number,
    url: string,
    createBackend: CreateBackendFn,
    send: (message: string | string[]) => void,
    close: () => void,
    isNodeInspector: boolean = false,
    enableNodeCDP: boolean = false,
    isWaitingForDebugger: () => boolean = () => false,
    isAcceptingConnections: () => boolean = () => true,
  ) {
    this.#nodeInspector = isNodeInspector;
    this.#enableNodeCDP = enableNodeCDP;
    this.#isWaitingForDebugger = isWaitingForDebugger;
    this.#isAcceptingConnections = isAcceptingConnections;
    this.#backendFactory = createBackend;
    this.#backendSend = send;
    this.#backendClose = close;
    this.#executionContextId = executionContextId;

    if (url.startsWith("unix://")) {
      this.#connectOverSocket({
        unix: unescapeUnixSocketUrl(url),
      });
      return;
    } else if (url.startsWith("fd://")) {
      this.#connectOverSocket({
        fd: Number(url.substring("fd://".length)),
      });
      return;
    } else if (url.startsWith("fd:")) {
      this.#connectOverSocket({
        fd: Number(url.substring("fd:".length)),
      });
      return;
    } else if (url.startsWith("unix:")) {
      this.#connectOverSocket({
        unix: url.substring("unix:".length),
      });
      return;
    } else if (url.startsWith("tcp://")) {
      const { hostname, port } = new URL(url);
      this.#connectOverSocket({
        hostname,
        port: port && port !== "0" ? Number(port) : undefined,
      });
      return;
    }

    this.#url = parseUrl(url);
    this.#listen();
  }

  get url(): URL | undefined {
    return this.#url;
  }

  get cdpUrl(): string | undefined {
    if (!this.#cdpPathname || !this.#url) return undefined;
    return `ws://${this.#cdpHost ?? this.#url.host}${this.#cdpPathname}`;
  }

  // Stops the node:inspector server and terminates its connections
  // (inspector.close() on the inspected thread).
  stop(): void {
    this.#server?.stop(true);
    this.#server = undefined;
    this.#loopbackServer?.stop(true);
    this.#loopbackServer = undefined;
    // stop(true) downgrades ServerWebSocket Strong→Weak but the Rust box frees only on GC sweep.
    // This thread's VM never runs destruct-on-exit, so force a sweep now.
    Bun.gc(true);
  }

  // A backend connection that is not tied to a WebSocket client, used for
  // commands forwarded from the in-process inspector.Session.
  createSessionBackend(receive: (...messages: string[]) => void): Backend {
    return this.#createBackend(true, receive, true);
  }

  #listen(): void {
    const { protocol, hostname, port, pathname } = this.#url!;

    if (protocol === "ws:" || protocol === "wss:" || protocol === "ws+tcp:") {
      const server = Bun.serve({
        hostname,
        // empty port from new URL("ws://host/") -> let the OS pick a free port instead of falling back to Bun.serve's default 3000
        port: port || 0,
        fetch: this.#fetch.bind(this),
        websocket: this.#websocket,
      });

      this.#server = server;
      this.#url!.hostname = server.hostname;
      this.#url!.port = `${server.port}`;
      if (this.#enableNodeCDP) {
        this.#cdpPathname = `/${randomId()}`;
        if (hostname === defaultHostname) {
          let v4Held = false;
          for (const loopback of ["127.0.0.1", "::1"]) {
            try {
              this.#loopbackServer = Bun.serve({
                hostname: loopback,
                port: server.port,
                fetch: this.#fetch.bind(this),
                websocket: this.#websocket,
              });
              break;
            } catch (e) {
              if (loopback === "127.0.0.1" && (e as any)?.code === "EADDRINUSE") v4Held = true;
            }
          }
          if (this.#loopbackServer || v4Held) this.#cdpHost = `127.0.0.1:${server.port}`;
        }
      }
      return;
    }

    if (protocol === "ws+unix:") {
      Bun.serve({
        unix: pathname,
        fetch: this.#fetch.bind(this),
        websocket: this.#websocket,
      });
      return;
    }

    throw new TypeError(`Unsupported protocol: '${protocol}' (expected 'ws:' or 'ws+unix:')`);
  }

  #connectOverSocket(networkOptions) {
    let backend;
    return Bun.connect<{ framer: SocketFramer; backend: Backend }>({
      ...networkOptions,
      socket: {
        open: socket => {
          let framer: SocketFramer;
          const callback = (...messages: string[]) => {
            for (const message of messages) {
              framer.send(socket, message);
            }
          };

          framer = new SocketFramer((message: string | string[]) => {
            backend.write(message);
          });
          backend = this.#createBackend(false, callback);
          socket.data = {
            framer,
            backend,
          };
          socket.ref();
        },
        data: (socket, bytes) => {
          if (!socket.data) {
            socket.terminate();
            return;
          }
          socket.data.framer.onData(socket, bytes);
        },
        drain: _socket => {},
        close: socket => {
          const socketData = socket.data;
          if (socketData) {
            const { backend, framer } = socketData;
            backend.close();
            framer.reset();
          }
        },
      },
    }).catch(err => {
      // Force us to send a disconnect message
      if (!backend) {
        backend = this.#createBackend(false, () => {});
        backend.close();
      }

      $debug("error:", err);
    });
  }

  get #websocket(): WebSocketHandler<Connection> & { internalAllowAnySecWebSocketKey: boolean } {
    return {
      idleTimeout: 0,
      closeOnBackpressureLimit: false,
      internalAllowAnySecWebSocketKey: true,
      open: ws => this.#open(ws, webSocketWriter(ws)),
      message: (ws, message) => {
        if (typeof message === "string") {
          this.#message(ws, message);
        } else {
          this.#error(ws, new Error("Unexpected binary message"));
        }
      },
      drain: ws => this.#drain(ws),
      close: ws => this.#close(ws),
    };
  }

  // Node-shaped /json/list payload. `host` is the request's Host header so tunneled clients get
  // reachable URLs (rejected hosts filtered in #fetch). https://github.com/nodejs/node/tree/main/src/inspector
  #nodeInspectorTargets(host: string | null): unknown[] {
    const { hostname, port } = this.#url!;
    const pathname = this.#cdpPathname ?? this.#url!.pathname;
    const id = pathname.slice(1);
    const wsAddress = `${host || `${hostname}:${port}`}${pathname}`;
    return [
      {
        description: "bun instance",
        devtoolsFrontendUrl: `devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws=${wsAddress}`,
        devtoolsFrontendUrlCompat: `devtools://devtools/bundled/inspector.html?experiments=true&v8only=true&ws=${wsAddress}`,
        faviconUrl: "https://bun.com/favicon.ico",
        id,
        title: `bun[${process.pid}]`,
        type: "node",
        url: "file://",
        webSocketDebuggerUrl: `ws://${wsAddress}`,
      },
    ];
  }

  #fetch(request: Request, server: WebSocketServer): Response | undefined {
    const { method, url, headers } = request;
    const { pathname } = new URL(url);

    if (method !== "GET") {
      return new Response(null, {
        status: 405, // Method Not Allowed
      });
    }

    const isUnix = this.#url!.protocol.includes("unix");
    if (!isUnix && !isHostAllowed(headers.get("Host"), this.#url!.hostname)) {
      return new Response(null, {
        status: 400, // Bad Request
      });
    }

    if (!isOriginAllowed(headers.get("Origin"))) {
      return new Response(null, {
        status: 403, // Forbidden
      });
    }

    switch (pathname) {
      case "/json/version":
        // Unlike /json/list below, CLI --inspect keeps the Bun shape: that payload
        // predates the CDP endpoint and test/cli/inspect/inspect.test.ts pins it.
        return Response.json(this.#nodeInspector ? nodeVersionInfo() : versionInfo());
      case "/json":
      case "/json/list":
        // Discovery endpoint used by CDP clients (chrome://inspect,
        // vscode-js-debug) to find the WebSocket URL. Served whenever a
        // CDP endpoint exists, as Node does.
        if (this.#nodeInspector || this.#cdpPathname) {
          return Response.json(this.#nodeInspectorTargets(headers.get("Host")));
        }
        break;
    }

    const isCDP = this.#cdpPathname !== undefined && pathname === this.#cdpPathname;

    // Refuse new CDP clients during exit handshake so reconnectors can't hold the process open
    // (InspectorIo::StopAcceptingNewConnections): https://github.com/nodejs/node/blob/main/src/inspector_agent.cc
    if ((this.#nodeInspector || isCDP) && !this.#isAcceptingConnections()) {
      return new Response(null, {
        status: 503, // Service Unavailable
      });
    }

    if (!isUnix && !isCDP && this.#url!.pathname !== pathname) {
      return new Response(null, {
        status: 404, // Not Found
      });
    }

    const data: Connection = {
      refEventLoop: headers.get("Ref-Event-Loop") === "0",
      isCDP,
    };

    if (!server.upgrade(request, { data })) {
      return new Response(null, {
        status: 426, // Upgrade Required
        headers: {
          "Upgrade": "websocket",
        },
      });
    }
  }

  #open(connection: ConnectionOwner, writer: Writer): void {
    const { data } = connection;
    const { refEventLoop } = data;

    const client = bufferedWriter(writer);

    if (this.#nodeInspector || data.isCDP) {
      // Node prints this on every remote attach; tools gate on it. fs.writeSync avoids reifying
      // Bun.stderr (its lazy Blob would leak at exit under LSAN). Best-effort like Node's
      // fprintf: a closed fd 2 (EBADF/EPIPE) must not abort the attach.
      try {
        require("node:fs").writeSync(2, "Debugger attached.\n");
      } catch {}
      // CDP adapter between WebSocket and JSC backend. Never ref the event loop (`true` = no ref):
      // Node exits with a debugger attached. https://github.com/nodejs/node/blob/main/src/inspector_agent.cc
      let adapter: any;
      function deliverToRemoteAdapter(...messages: string[]) {
        for (const message of messages) {
          adapter.handleBackendMessage(message);
        }
      }
      function writeToRemoteBackend(message: string) {
        void backend.write(message);
      }
      function writeToRemoteClient(message: string) {
        void client.write(message);
      }
      const backend = this.#createBackend(true, deliverToRemoteAdapter, true, true);
      adapter = new (cdpAdapterConstructor())(
        writeToRemoteBackend,
        writeToRemoteClient,
        allocateRemoteBackendId,
        this.#isWaitingForDebugger,
        this.#disconnectNotify,
      );

      data.client = client;
      data.backend = backend;
      data.adapter = adapter;
      return;
    }

    const backend = this.#createBackend(refEventLoop, (...messages: string[]) => {
      for (const message of messages) {
        client.write(message);
      }
    });

    data.client = client;
    data.backend = backend;
  }

  #message(connection: ConnectionOwner, message: string): void {
    const { data } = connection;
    const { backend, adapter } = data;
    $debug("remote:", message);
    if (adapter) {
      adapter.handleClientMessage(message);
      return;
    }
    backend?.write(message);
  }

  #drain(connection: ConnectionOwner): void {
    const { data } = connection;
    const { client } = data;
    client?.drain?.();
  }

  #close(connection: ConnectionOwner): void {
    const { data } = connection;
    const { backend, adapter } = data;
    adapter?.handleClientDisconnect();
    backend?.close();
  }

  #error(connection: ConnectionOwner, error: Error): void {
    const { data } = connection;
    const { backend, adapter } = data;
    console.error(error);
    adapter?.handleClientDisconnect();
    backend?.close();
    if (this.#nodeInspector || data.isCDP) {
      const binary = error?.message === "Unexpected binary message";
      connection.close?.(binary ? 1003 : 1011, binary ? "Unexpected binary message" : "Internal error");
    }
  }
}

async function connectToUnixServer(
  executionContextId: number,
  unix: string,
  createBackend: CreateBackendFn,
  send: (message: string) => void,
  close: () => void,
) {
  // Windows: TCP (VSCode/Node Unix-socket support is poor). POSIX: Unix sockets (no port
  // conflicts, no TCP-bind restrictions).
  let connectionOptions;
  if (unix.startsWith("unix:")) {
    unix = unescapeUnixSocketUrl(unix);
    if (unix.startsWith("unix://")) {
      unix = unix.substring("unix://".length);
    }
    connectionOptions = { unix };
  } else if (unix.startsWith("tcp:")) {
    try {
      const { hostname, port } = new URL(unix);
      connectionOptions = {
        hostname,
        port: Number(port),
      };
    } catch {
      exit("Invalid tcp: URL:" + unix);
      return;
    }
  } else if (unix.startsWith("/")) {
    connectionOptions = { unix };
  } else if (unix.startsWith("fd:")) {
    connectionOptions = { fd: Number(unix.substring("fd:".length)) };
  } else {
    $debug("Invalid inspector URL:" + unix);
    return;
  }

  const socket = await Bun.connect<{ framer: SocketFramer; backend: Backend }>({
    ...connectionOptions,
    socket: {
      open: socket => {
        const framer = new SocketFramer((message: string | string[]) => {
          backend.write(message);
        });

        const backendRaw = createBackend(executionContextId, true, (...messages: string[]) => {
          for (const message of messages) {
            framer.send(socket, message);
          }
        });

        const backend = {
          write: message => {
            send.$call(backendRaw, message);
            return true;
          },
          close: () => close.$call(backendRaw),
        };

        socket.data = {
          framer,
          backend,
        };

        socket.ref();
      },
      data: (socket, bytes) => {
        if (!socket.data) {
          socket.terminate();
          return;
        }

        socket.data.framer.onData(socket, bytes);
      },

      // Ensure we always drain the socket.
      // This is necessary due to socket.$write usage.
      drain: _socket => {},

      close: socket => {
        const socketData = socket.data;
        if (socketData) {
          const { backend, framer } = socketData;
          backend.close();
          framer.reset();
        }
      },
    },
  }).catch(error => {
    // Force it to close
    const backendRaw = createBackend(executionContextId, true, () => {});
    close.$call(backendRaw);

    $debug("error:", error);
  });

  return socket;
}

function versionInfo(): unknown {
  return {
    "Protocol-Version": "1.3",
    "Browser": "Bun",
    "User-Agent": navigator.userAgent,
    "WebKit-Version": process.versions.webkit,
    "Bun-Version": Bun.version,
    "Bun-Revision": Bun.revision,
  };
}

// Node-shaped /json/version payload, served for node:inspector servers so CDP
// clients recognize the target the same way they recognize a Node process.
function nodeVersionInfo(): unknown {
  return {
    "Browser": `Bun/${Bun.version}`,
    "Protocol-Version": "1.1",
  };
}

function webSocketWriter(ws: ServerWebSocket<unknown>): Writer {
  return {
    write: message => !!ws.sendText(message),
    close: () => ws.close(),
  };
}

function bufferedWriter(writer: Writer): Writer {
  let draining = false;
  let pendingMessages: string[] = [];

  return {
    write: message => {
      if (draining || !writer.write(message)) {
        pendingMessages.push(message);
      }
      return true;
    },
    drain: () => {
      draining = true;
      try {
        for (let i = 0; i < pendingMessages.length; i++) {
          if (!writer.write(pendingMessages[i])) {
            pendingMessages = pendingMessages.slice(i);
            return;
          }
        }
        pendingMessages.length = 0;
      } finally {
        draining = false;
      }
    },
    close: () => {
      writer.close();
      pendingMessages.length = 0;
    },
  };
}

const defaultHostname = "localhost";
const defaultPort = 6499;

function parseUrl(input: string): URL {
  if (input.startsWith("ws://") || input.startsWith("ws+unix://")) {
    return new URL(input);
  }
  const url = new URL(`ws://${defaultHostname}:${defaultPort}/${randomId()}`);
  for (const part of input.split(/(\[[a-z0-9:]+\])|:/).filter(Boolean)) {
    if (/^\d+$/.test(part)) {
      url.port = part;
      continue;
    }
    if (part.startsWith("[")) {
      url.hostname = part;
      continue;
    }
    if (part.startsWith("/")) {
      url.pathname = part;
      continue;
    }
    const [hostname, ...pathnames] = part.split("/");
    if (/^\d+$/.test(hostname)) {
      url.port = hostname;
    } else {
      url.hostname = hostname;
    }
    if (pathnames.length) {
      url.pathname = `/${pathnames.join("/")}`;
    }
  }
  return url;
}

// Reject unexpected web origins so a malicious page can't attach and eval. Non-browser clients
// send no Origin and are unaffected. https://github.com/nodejs/node/tree/main/src/inspector
function isOriginAllowed(origin: string | null): boolean {
  if (!origin) {
    return true;
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    // Includes the opaque "null" origin sent by sandboxed iframes and file://.
    return false;
  }
  const { protocol, hostname } = url;
  if (protocol !== "http:" && protocol !== "https:") {
    // Privileged schemes (e.g. devtools://) cannot be claimed by a web page.
    return true;
  }
  if (url.origin === "https://debug.bun.sh") {
    return true;
  }
  return hostname === "localhost" || hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(hostname);
}

function isHostAllowed(host: string | null, expectedHostname: string): boolean {
  if (!host) {
    return true;
  }
  let hostname: string;
  try {
    ({ hostname } = new URL(`ws://${host}`));
  } catch {
    return false;
  }
  if (hostname === expectedHostname || hostname === "localhost" || hostname === "localhost6") {
    return true;
  }
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return true;
  }
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function randomId() {
  return crypto.randomUUID();
}

const { enableANSIColors } = Bun;

function dim(string: string): string {
  if (enableANSIColors) {
    return `\x1b[2m${string}\x1b[22m`;
  }
  return string;
}

function link(url: string): string {
  if (enableANSIColors) {
    return `\x1b[1m\x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\\x1b[22m`;
  }
  return url;
}

function reset(): string {
  if (enableANSIColors) {
    return "\x1b[49m";
  }
  return "";
}

function notify(options): void {
  Bun.connect({
    ...options,
    socket: {
      open: socket => {
        socket.end("1");
      },
      data: () => {}, // required or it errors
    },
  }).catch(() => {
    // Best-effort
  });
}

function exit(...args: unknown[]): never {
  console.error(...args);
  process.exit(1);
}

type ConnectionOwner = {
  data: Connection;
  close?: (code?: number, reason?: string) => void;
};

type Connection = {
  refEventLoop: boolean;
  isCDP?: boolean;
  client?: Writer;
  backend?: Backend;
  // Present for node:inspector connections, which speak the V8 protocol.
  adapter?: any;
};

type Writer = {
  write: (message: string) => boolean;
  drain?: () => void;
  close: () => void;
};
