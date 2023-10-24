(function (){"use strict";// build3/tmp/internal/debugger.ts
var versionInfo = function() {
  return {
    "Protocol-Version": "1.3",
    Browser: "Bun",
    "User-Agent": navigator.userAgent,
    "WebKit-Version": process.versions.webkit,
    "Bun-Version": Bun.version,
    "Bun-Revision": Bun.revision
  };
};
var webSocketWriter = function(ws) {
  return {
    write: (message) => !!ws.sendText(message),
    close: () => ws.close()
  };
};
var socketWriter = function(socket) {
  return {
    write: (message) => !!socket.write(message),
    close: () => socket.end()
  };
};
var bufferedWriter = function(writer) {
  let draining = false;
  let pendingMessages = [];
  return {
    write: (message) => {
      if (draining || !writer.write(message)) {
        pendingMessages.push(message);
      }
      return true;
    },
    drain: () => {
      draining = true;
      try {
        for (let i = 0;i < pendingMessages.length; i++) {
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
    }
  };
};
var parseUrl = function(url) {
  try {
    if (!url) {
      return new URL(randomId(), `ws://${defaultHostname}:${defaultPort}/`);
    } else if (url.startsWith("/")) {
      return new URL(url, `ws://${defaultHostname}:${defaultPort}/`);
    } else if (/^[a-z+]+:\/\//i.test(url)) {
      return new URL(url);
    } else if (/^\d+$/.test(url)) {
      return new URL(randomId(), `ws://${defaultHostname}:${url}/`);
    } else if (!url.includes("/") && url.includes(":")) {
      return new URL(randomId(), `ws://${url}/`);
    } else if (!url.includes(":")) {
      const [hostname, pathname] = url.split("/", 2);
      return new URL(`ws://${hostname}:${defaultPort}/${pathname}`);
    } else {
      return new URL(randomId(), `ws://${url}`);
    }
  } catch {
    @throwTypeError(`Invalid hostname or URL: '${url}'`);
  }
};
var randomId = function() {
  return Math.random().toString(36).slice(2);
};
var dim = function(string) {
  if (enableANSIColors) {
    return `\x1B[2m${string}\x1B[22m`;
  }
  return string;
};
var link = function(url) {
  if (enableANSIColors) {
    return `\x1B[1m\x1B]8;;${url}\x1B\\${url}\x1B]8;;\x1B\\\x1B[22m`;
  }
  return url;
};
var reset = function() {
  if (enableANSIColors) {
    return "\x1B[49m";
  }
  return "";
};
var notify = function(unix) {
  Bun.connect({
    unix,
    socket: {
      open: (socket) => {
        socket.end("1");
      },
      data: () => {
      }
    }
  }).finally(() => {
  });
};
var exit = function(...args) {
  console.error(...args);
  process.exit(1);
};
var $;
$ = function(executionContextId, url, createBackend, send, close) {
  let debug;
  try {
    debug = new Debugger(executionContextId, url, createBackend, send, close);
  } catch (error) {
    exit("Failed to start inspector:\n", error);
  }
  const { protocol, href, host, pathname } = debug.url;
  if (!protocol.includes("unix")) {
    console.log(dim("--------------------- Bun Inspector ---------------------"), reset());
    console.log(`Listening:\n  ${dim(href)}`);
    if (protocol.includes("ws")) {
      console.log(`Inspect in browser:\n  ${link(`https://debug.bun.sh/#${host}${pathname}`)}`);
    }
    console.log(dim("--------------------- Bun Inspector ---------------------"), reset());
  }
  const unix = process.env["BUN_INSPECT_NOTIFY"];
  if (unix) {
    const { protocol: protocol2, pathname: pathname2 } = parseUrl(unix);
    if (protocol2 === "unix:") {
      notify(pathname2);
    }
  }
};

class Debugger {
  #url;
  #createBackend;
  constructor(executionContextId, url, createBackend, send, close) {
    this.#url = parseUrl(url);
    this.#createBackend = (refEventLoop, receive) => {
      const backend = createBackend(executionContextId, refEventLoop, receive);
      return {
        write: (message) => {
          send.@call(backend, message);
          return true;
        },
        close: () => close.@call(backend)
      };
    };
    this.#listen();
  }
  get url() {
    return this.#url;
  }
  #listen() {
    const { protocol, hostname, port, pathname } = this.#url;
    if (protocol === "ws:" || protocol === "ws+tcp:") {
      const server = Bun.serve({
        hostname,
        port,
        fetch: this.#fetch.bind(this),
        websocket: this.#websocket
      });
      this.#url.hostname = server.hostname;
      this.#url.port = `${server.port}`;
      return;
    }
    if (protocol === "ws+unix:") {
      Bun.serve({
        unix: pathname,
        fetch: this.#fetch.bind(this),
        websocket: this.#websocket
      });
      return;
    }
    @throwTypeError(`Unsupported protocol: '${protocol}' (expected 'ws:', 'ws+unix:', or 'unix:')`);
  }
  get #websocket() {
    return {
      idleTimeout: 0,
      closeOnBackpressureLimit: false,
      open: (ws) => this.#open(ws, webSocketWriter(ws)),
      message: (ws, message) => {
        if (typeof message === "string") {
          this.#message(ws, message);
        } else {
          this.#error(ws, new Error(`Unexpected binary message: ${message.toString()}`));
        }
      },
      drain: (ws) => this.#drain(ws),
      close: (ws) => this.#close(ws)
    };
  }
  #fetch(request, server) {
    const { method, url, headers } = request;
    const { pathname } = new URL(url);
    if (method !== "GET") {
      return new Response(null, {
        status: 405
      });
    }
    switch (pathname) {
      case "/json/version":
        return Response.json(versionInfo());
      case "/json":
      case "/json/list":
    }
    if (!this.#url.protocol.includes("unix") && this.#url.pathname !== pathname) {
      return new Response(null, {
        status: 404
      });
    }
    const data = {
      refEventLoop: headers.get("Ref-Event-Loop") === "0"
    };
    if (!server.upgrade(request, { data })) {
      return new Response(null, {
        status: 426,
        headers: {
          Upgrade: "websocket"
        }
      });
    }
  }
  get #socket() {
    return {
      open: (socket) => this.#open(socket, socketWriter(socket)),
      data: (socket, message) => this.#message(socket, message.toString()),
      drain: (socket) => this.#drain(socket),
      close: (socket) => this.#close(socket),
      error: (socket, error) => this.#error(socket, error),
      connectError: (_, error) => exit("Failed to start inspector:\n", error)
    };
  }
  #open(connection, writer) {
    const { data } = connection;
    const { refEventLoop } = data;
    const client = bufferedWriter(writer);
    const backend = this.#createBackend(refEventLoop, (...messages) => {
      for (const message of messages) {
        client.write(message);
      }
    });
    data.client = client;
    data.backend = backend;
  }
  #message(connection, message) {
    const { data } = connection;
    const { backend } = data;
    backend?.write(message);
  }
  #drain(connection) {
    const { data } = connection;
    const { client } = data;
    client?.drain?.();
  }
  #close(connection) {
    const { data } = connection;
    const { backend } = data;
    backend?.close();
  }
  #error(connection, error) {
    const { data } = connection;
    const { backend } = data;
    console.error(error);
    backend?.close();
  }
}
var defaultHostname = "localhost";
var defaultPort = 6499;
var { enableANSIColors } = Bun;
return $})
