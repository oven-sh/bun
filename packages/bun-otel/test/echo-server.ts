// Simple echo server for testing - returns all request headers as JSON
// Run as a separate process to avoid instrumentation
//
// Socket Protocol: Provides a fast JSONL-based command interface for making uninstrumented
// HTTP requests. This avoids spawning a new Bun process per request (~130ms overhead),
// achieving ~400x speedup (0.3ms vs 130ms). Critical for test performance with many requests.
import { bunEnv, bunExe } from "../../../test/harness";

type RequestMessage = {
  id: string;
  command: "fetch" | "shutdown";
  args?: {
    url: string;
    init?: RequestInit;
  };
};

type ResponseMessage = {
  id: string;
  success: boolean;
  result?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
  };
  error?: string;
};

if (import.meta.main) {
  const server = Bun.serve({
    port: parseInt(process.env.PORT || "0"),
    fetch(req: Request): Response {
      const url = new URL(req.url);

      // Shutdown endpoint for clean teardown
      if (url.pathname === "/shutdown") {
        server.stop();
        return new Response("shutting down", { status: 200 });
      }

      // Echo all request headers
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return Response.json({ headers });
    },
  });

  // Socket server for fast uninstrumented fetch requests
  const socketServer = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, data) {
        const lines = new TextDecoder().decode(data).split("\n").filter(Boolean);

        for (const line of lines) {
          try {
            const msg: RequestMessage = JSON.parse(line);
            handleCommand(socket, msg);
          } catch (err) {
            sendError(socket, "unknown", `Parse error: ${err}`);
          }
        }
      },
      open(socket) {
        // Client connected
      },
      close(socket) {
        // Client disconnected
      },
      error(socket, error) {
        console.error("Socket error:", error);
      },
    },
  });

  async function handleCommand(socket: any, msg: RequestMessage) {
    switch (msg.command) {
      case "fetch": {
        try {
          if (!msg.args?.url) {
            throw new Error("Missing url in fetch args");
          }
          const response = await fetch(msg.args.url, msg.args.init || {});
          const headers: Record<string, string> = {};
          response.headers.forEach((v, k) => {
            headers[k] = v;
          });

          sendResponse(socket, msg.id, {
            success: true,
            result: {
              status: response.status,
              statusText: response.statusText,
              headers,
              body: await response.text(),
            },
          });
        } catch (err) {
          sendError(socket, msg.id, String(err));
        }
        break;
      }

      case "shutdown": {
        sendResponse(socket, msg.id, { success: true });
        // Close socket server, then HTTP server
        socketServer.stop();
        server.stop();
        break;
      }

      default:
        sendError(socket, msg.id, `Unknown command: ${(msg as any).command}`);
    }
  }

  function sendResponse(socket: any, id: string, data: Omit<ResponseMessage, "id">) {
    socket.write(JSON.stringify({ id, ...data }) + "\n");
  }

  function sendError(socket: any, id: string, error: string) {
    socket.write(JSON.stringify({ id, success: false, error }) + "\n");
  }

  console.log(`Echo server listening on ${server.port}`);
  console.log(`Socket server listening on ${socketServer.port}`);
}

// Controller for managing echo server in tests
export class EchoServer {
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private port: number | null = null;
  private socketPort: number | null = null;
  private socketConnection: any = null;
  private pendingRequests = new Map<string, { resolve: Function; reject: Function }>();
  private requestCounter = 0;
  private lineBuffer = "";

  async start(): Promise<void> {
    this.proc = Bun.spawn([bunExe(), "packages/bun-otel/test/echo-server.ts"], {
      env: { ...bunEnv, PORT: "0" }, // ensure ephemeral port regardless of CI env
      stdout: "pipe",
      stderr: "inherit",
    });

    // Read both ports from stdout with a real timeout using Promise.race
    const decoder = new TextDecoder();
    const timeoutMs = 5000;

    try {
      const ports = await Promise.race([
        (async () => {
          let httpPort: number | null = null;
          let socketPort: number | null = null;

          // @ts-expect-error stdout is ReadableStream
          for await (const chunk of this.proc?.stdout) {
            const text = decoder.decode(chunk);

            // Parse both ports
            const httpMatch = text.match(/Echo server listening on (\d+)/);
            if (httpMatch) httpPort = parseInt(httpMatch[1]);

            const socketMatch = text.match(/Socket server listening on (\d+)/);
            if (socketMatch) socketPort = parseInt(socketMatch[1]);

            if (httpPort !== null && socketPort !== null) {
              return { httpPort, socketPort };
            }
          }
          throw new Error("Echo server exited before reporting both ports");
        })(),
        (async () => {
          await Bun.sleep(timeoutMs);
          throw new Error("Echo server failed to start within 5 seconds");
        })(),
      ]);

      this.port = ports.httpPort;
      this.socketPort = ports.socketPort;

      // Connect to socket server
      this.socketConnection = await Bun.connect({
        hostname: "127.0.0.1",
        port: this.socketPort,
        socket: {
          data: (socket, data) => this.handleSocketData(data),
          error: (socket, error) => {
            console.error("Socket connection error:", error);
            // Reject all pending requests
            for (const [id, pending] of this.pendingRequests) {
              pending.reject(new Error(`Socket error: ${error}`));
            }
            this.pendingRequests.clear();
          },
          close: socket => {
            // Reject all pending requests on disconnect
            for (const [id, pending] of this.pendingRequests) {
              pending.reject(new Error("Socket connection closed"));
            }
            this.pendingRequests.clear();
          },
        },
      });
    } catch (err) {
      if (this.proc) {
        this.proc.kill();
        this.proc = null;
      }
      throw err;
    }
  }

  private handleSocketData(data: Uint8Array) {
    // Accumulate data and parse line by line
    this.lineBuffer += new TextDecoder().decode(data);
    const lines = this.lineBuffer.split("\n");

    // Keep the last incomplete line in the buffer
    this.lineBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line) continue;

      try {
        const response: ResponseMessage = JSON.parse(line);
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          if (response.success) {
            pending.resolve(response.result);
          } else {
            pending.reject(new Error(response.error));
          }
        }
      } catch (err) {
        console.error("Failed to parse socket response:", err, "line:", line);
      }
    }
  }

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    if (!this.socketConnection) {
      throw new Error("Echo server not started or socket not connected");
    }

    const id = `req-${++this.requestCounter}`;
    const request: RequestMessage = { id, command: "fetch", args: { url, init } };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Send request
      this.socketConnection.write(JSON.stringify(request) + "\n");

      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${id} timed out after 5 seconds`));
        }
      }, 5000);
    }).then((result: any) => {
      // Convert result back to Response object
      return new Response(result.body, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      });
    });
  }

  async stop(): Promise<void> {
    if (this.socketConnection) {
      // Send shutdown command via socket
      try {
        const id = `req-shutdown-${Date.now()}`;
        const request: RequestMessage = { id, command: "shutdown" };
        this.socketConnection.write(JSON.stringify(request) + "\n");

        // Wait briefly for graceful shutdown
        await Bun.sleep(100);
      } catch {
        // Ignore errors during shutdown
      }

      // Close socket connection
      try {
        this.socketConnection.end();
      } catch {}
      this.socketConnection = null;
    }

    if (this.proc) {
      // Wait for graceful exit (up to 2 seconds), then force-kill if needed
      await Promise.race([this.proc.exited, Bun.sleep(2000)]).catch(() => {});
      this.proc.kill();
      await this.proc.exited.catch(() => {});
      this.proc = null;
    }

    this.port = null;
    this.socketPort = null;
    this.pendingRequests.clear();
  }

  getUrl(path: string = "/"): string {
    if (!this.port) {
      throw new Error("Echo server not started");
    }
    return `http://127.0.0.1:${this.port}${path}`;
  }

  get remoteControl() {
    return {
      fetch: (url: string, init?: RequestInit) => this.fetch(url, init),
    };
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.stop();
  }
}
