import type { Socket, ServerWebSocket, WebSocketHandler, Server as WebSocketServer } from "bun";
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

    socketFramerMessageLengthBuffer.writeUInt32BE(data.length, 0);
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

export default function (
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
        port,
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
        drain: socket => {},
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
        return Response.json(versionInfo());
      case "/json":
      case "/json/list":
      // TODO?
    }

    if (!this.#url!.protocol.includes("unix") && this.#url!.pathname !== pathname) {
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
    } catch (error) {
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
    const backendRaw = createBackend(executionContextId, true, (...messages: string[]) => {});
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

function randomId() {
  return Math.random().toString(36).slice(2);
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

type Writer = {
  write: (message: string) => boolean;
  drain?: () => void;
  close: () => void;
};
