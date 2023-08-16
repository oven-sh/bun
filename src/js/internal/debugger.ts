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

let defaultPort = 9230;

function generatePath() {
  return "/";
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
    if (/^[0-9]*$/.test(url)) {
      url = "ws://" + defaultHostname + ":" + url + generatePath();
    } else if (!url || url.startsWith("/")) {
      url = "ws://" + defaultHostname + ":" + defaultPort + generatePath();
    }

    try {
      var { hostname, port, pathname } = new URL(url);
      this.url = pathname.toLowerCase();
    } catch (e) {
      console.error("[Inspector]", "Failed to parse url", '"' + url + '"');
      process.exit(1);
    }

    let portNumber = Number(port);
    for (let tries = 0; tries < 10; tries++) {
      const server = Bun.serve<DebuggerWithMessageQueue>({
        hostname,
        port: portNumber++,
        development: false,

        // @ts-ignore
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
          const { pathname } = new URL(req.url);
          if (pathname.toLowerCase() === this.url) {
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
      });

      console.log("[Inspector] Listening at:" + "\n\n " + `ws://${server.hostname}:${server.port}${this.url}` + "\n");
      return server;
    }
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
