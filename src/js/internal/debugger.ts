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

  // `backend` is typed as `Backend | Writer` because callers pass sockets
  // carrying either shape (the #connectOverSocket/connectToUnixServer paths
  // use `Backend`, the #websocket path's SocketFramer.send uses `Backend`
  // too, but the underlying socket.data literal only needs to satisfy
  // whichever shape the caller declared). onData itself never reads
  // `socket.data.backend` -- it only frames bytes and calls `this.onMessage`
  // -- so widening this union costs nothing and lets both call sites
  // typecheck without an unsound cast.
  onData(socket: Socket<{ framer: SocketFramer; backend: Backend | Writer }>, data: Buffer): void {
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
) => unknown;

function startInspector(
  executionContextId: number,
  url: string,
  createBackend: CreateBackendFn,
  send: (message: string | string[]) => void,
  close: () => void,
  isAutomatic: boolean,
  urlIsServer: boolean,
): void {
  if (urlIsServer) {
    connectToUnixServer(executionContextId, url, createBackend, send, close);
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

  constructor(
    executionContextId: number,
    url: string,
    createBackend: CreateBackendFn,
    send: (message: string | string[]) => void,
    close: () => void,
  ) {
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
        return Response.json(versionInfo());
      case "/json":
      case "/json/list":
      // TODO?
    }

    if (!isUnix && this.#url!.pathname !== pathname) {
      return new Response(null, {
        status: 404, // Not Found
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
    const { backend } = data;
    $debug("remote:", message);
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

function webSocketWriter(ws: ServerWebSocket<unknown>): Writer {
  return {
    write: message => {
      // ws.sendText() returns a JS number: -1 (BACKPRESSURE), 0 (DROPPED), or
      // a positive byte count (SUCCESS). Previously this was collapsed with
      // `!!`, which coerces -1 to `true` -- indistinguishable from success --
      // so bufferedWriter (below) never reacted to backpressure at all. We
      // now surface the real tri-state result so bufferedWriter can retry a
      // genuine drop (0) and pace -- without re-sending -- a message that
      // merely reported backpressure (-1).
      //
      // `result === 0` is ambiguous in the Rust binding itself, not just here:
      // it means DROPPED, but it is ALSO what a genuinely SUCCESSful send of a
      // zero-length string returns (send_status_to_js's Success arm returns
      // `len as f64`, i.e. the byte length actually written -- 0 for an empty
      // buffer -- see src/runtime/server/ServerWebSocket.rs's send_status_to_js
      // and send_text). A closed socket also short-circuits to 0 before ever
      // calling send() (same file, send_text's `is_closed()` guard). Treating
      // every 0 as "dropped" is safe for CDP traffic specifically because
      // BunDebugger.cpp's sendMessageToFrontend skips empty messages before
      // they ever reach this writer (`if (message.length() == 0) return;`,
      // src/jsc/bindings/BunDebugger.cpp:217-218) -- so an empty-string
      // "success" can never actually occur here, only genuine drops and
      // closed-socket sends (which are also correctly queued, harmlessly, for
      // a connection that is going away).
      const result = ws.sendText(message);
      if (result === 0) return "dropped";
      if (result < 0) return "backpressure";
      return "success";
    },
    close: () => ws.close(),
  };
}

function bufferedWriter(writer: Writer): Writer {
  let draining = false;
  // Set once a write reports "backpressure" and cleared at the start of the
  // next drain(). While set, new writes are queued (not attempted) rather
  // than sent immediately, so we stop adding to the connection's backlog
  // until it has had a chance to drain. This intentionally does NOT requeue
  // the message that reported backpressure itself: per webSocketWriter's
  // contract above, that message was already accepted by uWS, and resending
  // it would duplicate it on the wire.
  let paced = false;
  let pendingMessages: string[] = [];

  return {
    write: message => {
      // Gate on pendingMessages.length too, not just `paced`: a "dropped"
      // result (below) queues the message but does not set `paced`. Without
      // this check, the very next write() would go straight to `writer.write`
      // below and could land on the wire before the queued message it was
      // supposed to follow -- a queued message must never be overtaken by a
      // later direct write. Once anything is queued, every subsequent write
      // has to queue behind it to preserve order, regardless of which of the
      // two states (paced or pendingMessages.length > 0) caused the queuing.
      if (draining || paced || pendingMessages.length > 0) {
        pendingMessages.push(message);
        return "success";
      }

      const result = writer.write(message);
      if (result === "dropped") {
        pendingMessages.push(message);
      } else if (result === "backpressure") {
        paced = true;
      }
      return "success";
    },
    drain: () => {
      draining = true;
      // A new drain cycle gets a fresh chance to write without pacing; if the
      // flush below hits backpressure again, `paced` is re-set below.
      paced = false;
      try {
        for (let i = 0; i < pendingMessages.length; i++) {
          const result = writer.write(pendingMessages[i]);
          if (result === "dropped") {
            // Not sent at all -- keep this message (and everything queued
            // after it, to preserve order) for the next drain.
            pendingMessages = pendingMessages.slice(i);
            return;
          }
          if (result === "backpressure") {
            // This message WAS accepted (see webSocketWriter) -- do not keep
            // it for retry, just pace subsequent messages until the next
            // drain.
            paced = true;
            pendingMessages = pendingMessages.slice(i + 1);
            return;
          }
        }
        // Every pending message was fully flushed: nothing left to retry.
        // (Previously this array was never cleared on a fully successful
        // pass, which would have re-sent already-delivered messages on the
        // next drain -- a duplicate-send bug of its own, and one that would
        // trigger far more often now that "backpressure" also routes through
        // this same queue.)
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
};

type Connection = {
  refEventLoop: boolean;
  client?: Writer;
  backend?: Backend;
};

/**
 * Result of a single write attempt, mirroring the three-way contract of
 * `ServerWebSocket.sendText()` (see `packages/bun-uws/src/WebSocket.h`,
 * `WebSocket::send()`'s doc comment and `SendStatus` enum):
 *   - "success"      the message was fully accepted with buffer room to spare.
 *   - "backpressure" the message WAS accepted into the socket's outbound
 *                     buffer (it will still be delivered), but the buffer is
 *                     now running high; callers should pace further writes
 *                     until the next `drain()` rather than re-send this
 *                     message -- resending it would duplicate it on the wire,
 *                     since uWS has already queued it once.
 *   - "dropped"       the message was NOT sent at all (outbound buffering
 *                      already exceeds the connection's backpressure limit);
 *                      this is a genuine loss and must be retried.
 */
type WriteResult = "success" | "backpressure" | "dropped";

type Writer = {
  write: (message: string) => WriteResult;
  drain?: () => void;
  close: () => void;
};

// Builtin modules under src/js/internal/** support exactly one export --
// `export default` -- mixing it with named exports fails the builtin
// bundler's codegen check (see src/js/README.md, "Builtin Modules"). To let
// `bun:internal-for-testing` unit-test the real bufferedWriter/webSocketWriter
// implementations (rather than a reimplementation in the test file that could
// silently drift from what's actually shipped), they ride along as a
// `testHooks` property on the default export instead of a second export.
export default Object.assign(startInspector, {
  testHooks: { webSocketWriter, bufferedWriter },
});
