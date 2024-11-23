import type { ServerWebSocket, Socket, SocketHandler, WebSocketHandler, Server as WebSocketServer } from "bun";

export default function (
  executionContextId: string,
  url: string,
  createBackend: (
    executionContextId: string,
    refEventLoop: boolean,
    receive: (...messages: string[]) => void,
  ) => unknown,
  send: (message: string) => void,
  close: () => void,
): void {
  let debug: Debugger | undefined;
  try {
    debug = new Debugger(executionContextId, url, createBackend, send, close);
  } catch (error) {
    exit("Failed to start inspector:\n", error);
  }

  const { protocol, href, host, pathname } = debug.url;
  if (!protocol.includes("unix")) {
    Bun.write(Bun.stderr, dim("--------------------- Bun Inspector ---------------------") + reset() + "\n");
    Bun.write(Bun.stderr, `Listening:\n  ${dim(href)}\n`);
    if (protocol.includes("ws")) {
      Bun.write(Bun.stderr, `Inspect in browser:\n  ${link(`https://debug.bun.sh/#${host}${pathname}`)}\n`);
    }
    Bun.write(Bun.stderr, dim("--------------------- Bun Inspector ---------------------") + reset() + "\n");
  }

  const notifyUrl = process.env["BUN_INSPECT_NOTIFY"] || "";
  if (notifyUrl) {
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

class Debugger {
  #url: URL;
  #createBackend: (refEventLoop: boolean, receive: (...messages: string[]) => void) => Writer;

  constructor(
    executionContextId: string,
    url: string,
    createBackend: (
      executionContextId: string,
      refEventLoop: boolean,
      receive: (...messages: string[]) => void,
    ) => unknown,
    send: (message: string) => void,
    close: () => void,
  ) {
    this.#url = parseUrl(url);
    this.#createBackend = (refEventLoop, receive) => {
      const backend = createBackend(executionContextId, refEventLoop, receive);
      return {
        write: message => {
          send.$call(backend, message);
          return true;
        },
        close: () => close.$call(backend),
      };
    };
    this.#listen();
  }

  get url(): URL {
    return this.#url;
  }

  #listen(): void {
    const { protocol, hostname, port, pathname } = this.#url;

    if (protocol === "ws:" || protocol === "wss:" || protocol === "ws+tcp:") {
      const server = Bun.serve({
        hostname,
        port,
        fetch: this.#fetch.bind(this),
        websocket: this.#websocket,
      });
      this.#url.hostname = server.hostname;
      this.#url.port = `${server.port}`;
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

    if (!this.#url.protocol.includes("unix") && this.#url.pathname !== pathname) {
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

  get #socket(): SocketHandler<Connection> {
    return {
      open: socket => this.#open(socket, socketWriter(socket)),
      data: (socket, message) => this.#message(socket, message.toString()),
      drain: socket => this.#drain(socket),
      close: socket => this.#close(socket),
      error: (socket, error) => this.#error(socket, error),
      connectError: (_, error) => exit("Failed to start inspector:\n", error),
    };
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
  let sdfafdsa  = [];
  const backendRaw = createBackend(executionContextId, true, (...messages: string[]) => {
    for (const message of messages) {
      framer.send(socket, message);
    }
  });
  const socket = await Bun.connect<{ framer: SocketFramer; backend: Backend }>({
    unix,
    socket: {
      open: socket => {
        const framer = new SocketFramer((message: string | string[]) => {
          backend.write(message);
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

function socketWriter(socket: Socket<unknown>): Writer {
  return {
    write: message => !!socket.write(message),
    close: () => socket.end(),
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
  if (input.startsWith("ws://") || input.startsWith("ws+unix://") || input.startsWith("unix://")) {
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
  }).finally(() => {
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
  backend?: Writer;
};

type Writer = {
  write: (message: string) => boolean;
  drain?: () => void;
  close: () => void;
};
