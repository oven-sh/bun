import type * as BunType from "bun";

// We want to avoid dealing with creating a prototype for the inspector class
let sendFn_, disconnectFn_;

var debuggerCounter = 1;
class DebuggerWithMessageQueue {
  debugger?: Debugger = undefined;
  messageQueue: string[] = [];
  count: number = debuggerCounter++;

  send(msg: string) {
    sendFn_.call(this.debugger, msg);
  }

  disconnect() {
    disconnectFn_.call(this.debugger);
    this.messageQueue.length = 0;
  }
}

let defaultPort = 6499;

let generatedPath: string = "";
function generatePath() {
  if (!generatedPath) {
    generatedPath = "/" + Math.random().toString(36).slice(2);
  }

  return generatedPath;
}

function terminalLink(url) {
  if (Bun.enableANSIColors) {
    // bold + hyperlink + reset
    return "\x1b[1m\x1b]8;;" + url + "\x1b\\" + url + "\x1b]8;;\x1b\\" + "\x1b[22m";
  }

  return url;
}

function dim(text) {
  if (Bun.enableANSIColors) {
    return "\x1b[2m" + text + "\x1b[22m";
  }

  return text;
}

class WebSocketListener {
  server: BunType.Server;
  url: string = "";
  createInspectorConnection;
  scriptExecutionContextId: number = 0;
  activeConnections: Set<BunType.ServerWebSocket<DebuggerWithMessageQueue>> = new Set();

  constructor(scriptExecutionContextId: number = 0, url: string, createInspectorConnection) {
    this.scriptExecutionContextId = scriptExecutionContextId;
    this.createInspectorConnection = createInspectorConnection;
    this.server = this.start(url);
  }

  start(url: string): BunType.Server {
    let defaultHostname = "localhost";
    let usingDefaultPort = false;
    if (/^[0-9]*$/.test(url)) {
      url = "ws://" + defaultHostname + ":" + url + generatePath();
    } else if (!url || url.startsWith("/")) {
      url = "ws://" + defaultHostname + ":" + defaultPort + generatePath();
      usingDefaultPort = true;
    } else if (url.includes(":") && !url.includes("://")) {
      try {
        const insertSlash = !url.includes("/");
        url = new URL("ws://" + url).href;
        if (insertSlash) {
          url += generatePath().slice(1);
        }
      } catch (e) {
        console.error("[Inspector]", "Failed to parse url", '"' + url + '"');
        process.exit(1);
      }
    }

    try {
      var { hostname, port, pathname } = new URL(url);
      this.url = pathname.toLowerCase();
    } catch (e) {
      console.error("[Inspector]", "Failed to parse url", '"' + url + '"');
      process.exit(1);
    }

    const serveOptions: BunType.WebSocketServeOptions<DebuggerWithMessageQueue> = {
      hostname,
      development: false,

      //  ts-ignore
      reusePort: false,

      websocket: {
        idleTimeout: 0,
        open: socket => {
          var connection = new DebuggerWithMessageQueue();
          socket.data = connection;
          this.activeConnections.add(socket);
          connection.debugger = this.createInspectorConnection(this.scriptExecutionContextId, (...msgs: string[]) => {
            if (socket.readyState > 1) {
              connection.disconnect();
              return;
            }

            if (connection.messageQueue.length > 0) {
              connection.messageQueue.push(...msgs);
              return;
            }

            for (let i = 0; i < msgs.length; i++) {
              if (!socket.sendText(msgs[i])) {
                if (socket.readyState < 2) {
                  connection.messageQueue.push(...msgs.slice(i));
                }
                return;
              }
            }
          });

          console.log(
            "[Inspector]",
            "Connection #" + connection.count + " opened",
            "(" +
              new Intl.DateTimeFormat(undefined, {
                "timeStyle": "long",
                "dateStyle": "short",
              }).format(new Date()) +
              ")",
          );
        },
        drain: socket => {
          const queue = socket.data.messageQueue;
          for (let i = 0; i < queue.length; i++) {
            if (!socket.sendText(queue[i])) {
              socket.data.messageQueue = queue.slice(i);
              return;
            }
          }
          queue.length = 0;
        },
        message: (socket, message) => {
          if (typeof message !== "string") {
            console.warn("[Inspector]", "Received non-string message");
            return;
          }
          socket.data.send(message as string);
        },
        close: socket => {
          socket.data.disconnect();
          console.log(
            "[Inspector]",
            "Connection #" + socket.data.count + " closed",
            "(" +
              new Intl.DateTimeFormat(undefined, {
                "timeStyle": "long",
                "dateStyle": "short",
              }).format(new Date()) +
              ")",
          );
          this.activeConnections.delete(socket);
        },
      },
      fetch: (req, server) => {
        let { pathname } = new URL(req.url);
        pathname = pathname.toLowerCase();

        if (pathname === "/json/version") {
          return Response.json({
            "Browser": navigator.userAgent,
            "WebKit-Version": process.versions.webkit,
            "Bun-Version": Bun.version,
            "Bun-Revision": Bun.revision,
          });
        }

        if (pathname === this.url) {
          if (server.upgrade(req)) {
            return new Response();
          }

          return new Response("WebSocket expected", {
            status: 400,
          });
        }

        return new Response("Not found", {
          status: 404,
        });
      },
    };

    if (port === "") {
      port = defaultPort + "";
    }

    let portNumber = Number(port);
    var server, lastError;

    if (usingDefaultPort) {
      for (let tries = 0; tries < 10 && !server; tries++) {
        try {
          lastError = undefined;
          server = Bun.serve<DebuggerWithMessageQueue>({
            ...serveOptions,
            port: portNumber++,
          });
        } catch (e) {
          lastError = e;
        }
      }
    } else {
      try {
        server = Bun.serve<DebuggerWithMessageQueue>({
          ...serveOptions,
          port: portNumber,
        });
      } catch (e) {
        lastError = e;
      }
    }

    if (!server) {
      console.error("[Inspector]", "Failed to start server");
      if (lastError) console.error(lastError);
      process.exit(1);
    }

    let textToWrite = "";
    function writeToConsole(text) {
      textToWrite += text;
    }
    function flushToConsole() {
      console.write(textToWrite);
    }

    // yellow foreground
    writeToConsole(dim(`------------------ Bun Inspector ------------------` + "\n"));
    // reset background
    writeToConsole("\x1b[49m");

    writeToConsole(
      "Listening at:\n  " +
        `ws://${hostname}:${server.port}${this.url}` +
        "\n\n" +
        "Inspect in browser:\n  " +
        terminalLink(new URL(`https://debug.bun.sh#${server.hostname}:${server.port}${this.url}`).href) +
        "\n",
    );
    writeToConsole(dim(`------------------ Bun Inspector ------------------` + "\n"));
    flushToConsole();

    return server;
  }
}

interface Debugger {
  send(msg: string): void;
  disconnect(): void;
}

var listener: WebSocketListener;

export default function start(debuggerId, hostOrPort, createInspectorConnection, sendFn, disconnectFn) {
  try {
    sendFn_ = sendFn;
    disconnectFn_ = disconnectFn;
    globalThis.listener = listener ||= new WebSocketListener(debuggerId, hostOrPort, createInspectorConnection);
  } catch (e) {
    console.error("Bun Inspector threw an exception\n", e);
    process.exit(1);
  }

  return `http://${listener.server.hostname}:${listener.server.port}${listener.url}`;
}
