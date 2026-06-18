import type { ServerWebSocket, Socket, WebSocketHandler, Server as WebSocketServer } from "bun";
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
        if (this.sizeBufferIndex + this.bufferedData.length < 4) {
          const remainingBytes = Math.min(4 - this.sizeBufferIndex, this.bufferedData.length);
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
) => unknown;

// CDP translation is only needed for node:inspector servers, so load it lazily.
let lazyInspectorCDPAdapter: any;
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
): void {
  if (urlIsServer) {
    connectToUnixServer(executionContextId, url, createBackend, send, close);
    return;
  }

  if (isNodeInspector) {
    // node:inspector's inspector.open(): connections speak the V8 Chrome
    // DevTools Protocol, the listening URL is reported back to the inspected
    // thread (which prints Node's "Debugger listening on ..." line), and a
    // control callback lets the inspected thread close the server or forward
    // commands from the in-process inspector.Session.
    let debug: Debugger;
    try {
      debug = new Debugger(executionContextId, url, createBackend, send, close, true);
    } catch (error) {
      reportNodeInspectorServerStarted("", undefined, `${(error as Error)?.message ?? error}`);
      return;
    }

    let sessionBackend: Backend | undefined;
    let sessionAdapter: any;
    const control = (message: string) => {
      let parsed: any;
      try {
        parsed = JSON.parse(message);
      } catch {
        return;
      }
      switch (parsed?.type) {
        case "close":
          sessionBackend?.close();
          sessionBackend = undefined;
          sessionAdapter = undefined;
          debug.stop();
          return;
        case "command": {
          // A CDP command forwarded from the inspected thread's in-process
          // inspector.Session (e.g. Debugger.setBreakpointByUrl from vitest
          // --inspect-brk). Responses stay on this thread; the in-process
          // Session treats these as fire-and-forget.
          if (!sessionAdapter) {
            let adapter: any;
            sessionBackend = debug.createSessionBackend((...messages: string[]) => {
              for (const backendMessage of messages) {
                adapter.handleBackendMessage(backendMessage);
              }
            });
            adapter = new (cdpAdapterConstructor())(
              (backendMessage: string) => void sessionBackend?.write(backendMessage),
              () => {},
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

    reportNodeInspectorServerStarted(debug.url!.href, control, undefined);
    return;
  }

  let debug: Debugger | undefined;
  try {
    debug = new Debugger(executionContextId, url, createBackend, send, close);
  } catch (error) {
    exit("Failed to start inspector:\n", error);
  }

  // If the user types --inspect, we print the URL to the console.
  // If the user is using an editor extension, don't print anything.
  if (!isAutomatic) {
    if (debug.url) {
      const { protocol, href, host, pathname } = debug.url;
      if (!protocol.includes("unix")) {
        Bun.write(Bun.stderr, dim("--------------------- Bun Inspector ---------------------") + reset() + "\n");
        Bun.write(Bun.stderr, `Listening:\n  ${dim(href)}\n`);
        if (protocol.includes("ws")) {
          Bun.write(Bun.stderr, `Inspect in browser:\n  ${link(`https://debug.bun.sh/#${host}${pathname}`)}\n`);
        }
        Bun.write(Bun.stderr, dim("--------------------- Bun Inspector ---------------------") + reset() + "\n");
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

function unescapeUnixSocketUrl(href: string) {
  if (href.startsWith("unix://%2F")) {
    return decodeURIComponent(href.substring("unix://".length));
  }

  return href;
}

class Debugger {
  #url?: URL;
  #createBackend: (refEventLoop: boolean, receive: (...messages: string[]) => void) => Backend;
  // node:inspector mode: connections speak the V8 Chrome DevTools Protocol and
  // /json discovery endpoints are served.
  #nodeInspector = false;
  #server?: WebSocketServer;

  constructor(
    executionContextId: number,
    url: string,
    createBackend: CreateBackendFn,
    send: (message: string | string[]) => void,
    close: () => void,
    isNodeInspector: boolean = false,
  ) {
    this.#nodeInspector = isNodeInspector;
    try {
      this.#createBackend = (refEventLoop, receive) => {
        const backend = createBackend(executionContextId, refEventLoop, receive);
        return {
          write: (message: string | string[]) => {
            send.$call(backend, message);
            return true;
          },
          close: () => close.$call(backend),
        };
      };

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
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  get url(): URL | undefined {
    return this.#url;
  }

  // Stops the node:inspector server and terminates its connections
  // (inspector.close() on the inspected thread).
  stop(): void {
    this.#server?.stop(true);
    this.#server = undefined;
  }

  // A backend connection that is not tied to a WebSocket client, used for
  // commands forwarded from the in-process inspector.Session.
  createSessionBackend(receive: (...messages: string[]) => void): Backend {
    return this.#createBackend(true, receive);
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
          if (socket.data) {
            const { backend, framer } = socket.data;
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

  get #websocket(): WebSocketHandler<Connection> {
    return {
      idleTimeout: 0,
      closeOnBackpressureLimit: false,
      open: ws => this.#open(ws, webSocketWriter(ws)),
      message: (ws, message) => {
        if (typeof message === "string") {
          this.#message(ws, message);
        } else {
          this.#error(ws, new Error(`Unexpected binary message: ${message.toString()}`));
        }
      },
      drain: ws => this.#drain(ws),
      close: ws => this.#close(ws),
    };
  }

  // Node-shaped /json/list payload describing the single debuggable target.
  #nodeInspectorTargets(): unknown[] {
    const { hostname, port, pathname } = this.#url!;
    const id = pathname.slice(1);
    const wsAddress = `${hostname}:${port}${pathname}`;
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

    switch (pathname) {
      case "/json/version":
        return Response.json(this.#nodeInspector ? nodeVersionInfo() : versionInfo());
      case "/json":
      case "/json/list":
        // Discovery endpoint used by CDP clients (chrome://inspect, vscode-js-debug)
        // to find the WebSocket URL. Only served for node:inspector servers; the
        // Bun-protocol inspector has no CDP-speaking clients to discover it.
        if (this.#nodeInspector) {
          return Response.json(this.#nodeInspectorTargets());
        }
        break;
    }

    if (!this.#url!.protocol.includes("unix") && this.#url!.pathname !== pathname) {
      return new Response(null, {
        status: 404, // Not Found
      });
    }

    if (!isOriginAllowed(headers.get("Origin"))) {
      return new Response(null, {
        status: 403, // Forbidden
      });
    }

    const data: Connection = {
      refEventLoop: headers.get("Ref-Event-Loop") === "0",
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

    if (this.#nodeInspector) {
      // node:inspector clients speak CDP; the adapter sits between the
      // WebSocket and the JSC-protocol backend connection.
      let adapter: any;
      const backend = this.#createBackend(refEventLoop, (...messages: string[]) => {
        for (const message of messages) {
          adapter.handleBackendMessage(message);
        }
      });
      adapter = new (cdpAdapterConstructor())(
        (message: string) => void backend.write(message),
        (message: string) => void client.write(message),
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
    const { backend } = data;
    backend?.close();
  }

  #error(connection: ConnectionOwner, error: Error): void {
    const { data } = connection;
    const { backend } = data;
    console.error(error);
    backend?.close();
  }
}

async function connectToUnixServer(
  executionContextId: number,
  unix: string,
  createBackend: CreateBackendFn,
  send: (message: string) => void,
  close: () => void,
) {
  // Windows uses TCP.
  // POSIX uses Unix sockets.
  //
  // We use TCP on Windows because VSCode/Node doesn't seem to support Unix sockets very well.
  //
  // Unix sockets are preferred because there's less of a risk of conflicting
  // with other tools or a port already being used + sometimes machines don't
  // allow binding to TCP ports.
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
        if (socket.data) {
          const { backend, framer } = socket.data;
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

// Browsers always send an `Origin` header on WebSocket handshakes, so rejecting
// unexpected web origins prevents a malicious website from connecting to the
// inspector and evaluating code. This matters most when the user passes an
// explicit pathname to --inspect, which replaces the random UUID pathname that
// otherwise acts as a bearer token. Non-browser clients (IDEs, CLI tools) do
// not send an `Origin` header and are unaffected.
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
};

type Connection = {
  refEventLoop: boolean;
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
