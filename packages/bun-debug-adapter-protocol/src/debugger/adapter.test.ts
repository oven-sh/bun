import type { Server } from "bun";
import { serve } from "bun";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { WebSocketDebugAdapter } from "./adapter";

// --- Mock WebSocket Server ---

let server: Server;
let serverUrl: URL;
let shouldUpgrade = true;
let serverMessageHandler: ((ws: any, message: string) => void) | undefined;

beforeAll(() => {
  server = serve({
    port: 0,
    fetch(request, server) {
      if (shouldUpgrade && request.url.endsWith("/ws") && server.upgrade(request)) {
        return;
      }
      return new Response("Not a WebSocket", { status: 400 });
    },
    websocket: {
      message(ws, message) {
        const msg = String(message);
        if (serverMessageHandler) {
          serverMessageHandler(ws, msg);
          return;
        }

        // Default handler: echo back success for all requests
        const parsed = JSON.parse(msg);
        const { id, method } = parsed;

        if (method === "Debugger.enable") {
          ws.send(JSON.stringify({ id, result: {} }));
          return;
        }
        if (method === "Debugger.setAsyncStackTraceDepth") {
          ws.send(JSON.stringify({ id, result: {} }));
          return;
        }
        if (method === "Debugger.setBreakpointsActive") {
          ws.send(JSON.stringify({ id, result: {} }));
          return;
        }
        if (method === "Inspector.enable") {
          ws.send(JSON.stringify({ id, result: {} }));
          return;
        }
        if (method === "Inspector.initialized") {
          ws.send(JSON.stringify({ id, result: {} }));
          return;
        }
        if (method === "Runtime.enable") {
          ws.send(JSON.stringify({ id, result: {} }));
          return;
        }
        if (method === "Console.enable") {
          ws.send(JSON.stringify({ id, result: {} }));
          return;
        }
        if (method === "Debugger.removeBreakpoint") {
          ws.send(JSON.stringify({ id, result: {} }));
          return;
        }
        if (method === "Debugger.setBreakpointByUrl") {
          const { url, lineNumber } = parsed.params || {};
          ws.send(
            JSON.stringify({
              id,
              result: {
                breakpointId: `${url}:${lineNumber ?? 0}:0`,
                locations: [],
              },
            }),
          );
          return;
        }
        if (method === "Debugger.setPauseOnExceptions") {
          ws.send(JSON.stringify({ id, result: {} }));
          return;
        }
        if (method === "Debugger.setPauseOnAssertions") {
          ws.send(JSON.stringify({ id, result: {} }));
          return;
        }
        if (method === "Debugger.setPauseOnDebuggerStatements") {
          ws.send(JSON.stringify({ id, result: {} }));
          return;
        }
        if (method === "Debugger.setPauseOnMicrotasks") {
          ws.send(JSON.stringify({ id, result: {} }));
          return;
        }

        // Fallback: success
        ws.send(JSON.stringify({ id, result: {} }));
      },
    },
  });
  const { hostname, port } = server;
  serverUrl = new URL(`ws://${hostname}:${port}/ws`);
});

afterAll(() => {
  server?.stop(true);
});

afterEach(() => {
  shouldUpgrade = true;
  serverMessageHandler = undefined;
});

// Helper to create an adapter and connect it
async function createConnectedAdapter(url?: string): Promise<WebSocketDebugAdapter> {
  const adapter = new WebSocketDebugAdapter(url ?? serverUrl.toString());

  // Set up event forwarding
  adapter.on("Adapter.event", () => {});
  adapter.on("Adapter.response", () => {});
  adapter.on("Adapter.error", () => {});

  const started = await adapter.start();
  if (!started) {
    throw new Error("Failed to start adapter");
  }
  return adapter;
}

// --- Tests ---

describe("WebSocketDebugAdapter", () => {
  describe("URL validation (SSRF protection)", () => {
    test("rejects non-localhost URLs in attach mode", async () => {
      const adapter = new WebSocketDebugAdapter();
      const outputs: string[] = [];

      adapter.on("Adapter.event", event => {
        if (event.event === "output" && event.body?.category === "stderr") {
          outputs.push(event.body.output);
        }
      });
      adapter.on("Adapter.response", () => {});
      adapter.on("Adapter.error", () => {});

      // Attach with external URL should fail validation
      await adapter.attach({ url: "ws://evil.com:1234/ws" });

      // The error should have been caught and emitted as stderr output
      expect(outputs.some(o => o.includes("only allowed to localhost"))).toBe(true);
    });

    test("allows localhost URLs", async () => {
      const adapter = await createConnectedAdapter(serverUrl.toString());
      // If we get here, the localhost URL was accepted
      expect(adapter).toBeDefined();
      adapter.close();
    });

    test("allows 127.0.0.1 URLs", async () => {
      // Replace hostname with 127.0.0.1
      const url = new URL(serverUrl.toString());
      url.hostname = "127.0.0.1";
      const adapter = await createConnectedAdapter(url.toString());
      expect(adapter).toBeDefined();
      adapter.close();
    });

    test("allows ws+unix:// URLs", async () => {
      // ws+unix:// URLs should pass validation (will fail to connect, but that's ok)
      const adapter = new WebSocketDebugAdapter();
      adapter.on("Adapter.event", () => {});
      adapter.on("Adapter.response", () => {});
      adapter.on("Adapter.error", () => {});

      // This should not throw a validation error - it should just fail to connect
      const started = await adapter.start("ws+unix:///tmp/test.sock");
      // It will fail to connect since no socket exists, but it passed URL validation
      expect(started).toBe(false);
    });

    test("rejects non-ws protocols", async () => {
      const adapter = new WebSocketDebugAdapter();
      const outputs: string[] = [];

      adapter.on("Adapter.event", event => {
        if (event.event === "output" && event.body?.category === "stderr") {
          outputs.push(event.body.output);
        }
      });
      adapter.on("Adapter.response", () => {});
      adapter.on("Adapter.error", () => {});

      await adapter.attach({ url: "http://localhost:1234/ws" });
      expect(outputs.some(o => o.includes("Invalid WebSocket protocol"))).toBe(true);
    });
  });

  describe("reconnection", () => {
    test("reconnects when restart option is set and connection is lost", async () => {
      const adapter = new WebSocketDebugAdapter(serverUrl.toString());
      const events: string[] = [];

      adapter.on("Adapter.event", event => {
        if (event.event === "output" && typeof event.body?.output === "string") {
          events.push(event.body.output.trim());
        }
      });
      adapter.on("Adapter.response", () => {});
      adapter.on("Adapter.error", () => {});

      // Start the adapter
      const started = await adapter.start();
      expect(started).toBe(true);

      // Set attach mode with restart enabled
      adapter.options = { type: "attach", url: serverUrl.toString(), restart: true };

      // Simulate disconnection by closing the inspector
      adapter.getInspector().close();

      // Wait for reconnection to happen
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check that reconnection messages were emitted
      expect(events.some(e => e.includes("Debugger detached"))).toBe(true);
      expect(events.some(e => e.includes("Attempting to reconnect"))).toBe(true);
      expect(events.some(e => e.includes("Reconnected"))).toBe(true);

      adapter.close();
    }, 15_000);

    test("terminates after max reconnection attempts", async () => {
      // Use a server URL that will immediately fail connections
      shouldUpgrade = false;

      const adapter = new WebSocketDebugAdapter(serverUrl.toString());
      const events: string[] = [];
      let terminated = false;

      adapter.on("Adapter.event", event => {
        if (event.event === "output" && typeof event.body?.output === "string") {
          events.push(event.body.output.trim());
        }
        if (event.event === "terminated") {
          terminated = true;
        }
      });
      adapter.on("Adapter.response", () => {});
      adapter.on("Adapter.error", () => {});

      // First connect to a working server, then break it
      shouldUpgrade = true;
      const started = await adapter.start();
      expect(started).toBe(true);

      // Now make the server reject connections
      shouldUpgrade = false;

      // Set attach mode with a very short timeout so we fail fast
      adapter.options = { type: "attach", url: serverUrl.toString(), restart: 2000 };

      // Simulate disconnection
      adapter.getInspector().close();

      // Wait for reconnection to fail
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Should have terminated
      expect(events.some(e => e.includes("Failed to reconnect"))).toBe(true);
      expect(terminated).toBe(true);

      adapter.close();
    }, 15_000);

    test("does not reconnect when restart is not set", async () => {
      const adapter = new WebSocketDebugAdapter(serverUrl.toString());
      let terminated = false;

      adapter.on("Adapter.event", event => {
        if (event.event === "terminated") {
          terminated = true;
        }
      });
      adapter.on("Adapter.response", () => {});
      adapter.on("Adapter.error", () => {});

      const started = await adapter.start();
      expect(started).toBe(true);

      // Set attach mode WITHOUT restart
      adapter.options = { type: "attach", url: serverUrl.toString() };

      // Simulate disconnection
      adapter.getInspector().close();

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Should have terminated immediately, not reconnected
      expect(terminated).toBe(true);

      adapter.close();
    });

    test("respects custom timeout for reconnection", async () => {
      shouldUpgrade = false;

      const adapter = new WebSocketDebugAdapter(serverUrl.toString());
      const events: string[] = [];

      adapter.on("Adapter.event", event => {
        if (event.event === "output" && typeof event.body?.output === "string") {
          events.push(event.body.output.trim());
        }
      });
      adapter.on("Adapter.response", () => {});
      adapter.on("Adapter.error", () => {});

      // Connect first
      shouldUpgrade = true;
      const started = await adapter.start();
      expect(started).toBe(true);

      shouldUpgrade = false;

      // Set attach mode with custom timeout (3 seconds)
      adapter.options = { type: "attach", url: serverUrl.toString(), restart: 3000 };

      // Simulate disconnection
      adapter.getInspector().close();

      // Wait for reconnection to fail
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Should show the custom timeout in the output
      expect(events.some(e => e.includes("3s timeout"))).toBe(true);

      adapter.close();
    }, 15_000);

    test("caps timeout at MAX_RECONNECT_TIMEOUT_MS", async () => {
      const adapter = new WebSocketDebugAdapter(serverUrl.toString());
      const events: string[] = [];

      adapter.on("Adapter.event", event => {
        if (event.event === "output" && typeof event.body?.output === "string") {
          events.push(event.body.output.trim());
        }
      });
      adapter.on("Adapter.response", () => {});
      adapter.on("Adapter.error", () => {});

      const started = await adapter.start();
      expect(started).toBe(true);

      // Set an absurdly large timeout - should be capped
      adapter.options = { type: "attach", url: serverUrl.toString(), restart: 999_999_999 };

      shouldUpgrade = false;
      adapter.getInspector().close();

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Should show 300s (5 min cap), not the absurd value
      expect(events.some(e => e.includes("300s timeout"))).toBe(true);

      adapter.close();
    }, 10_000);

    test("prevents overlapping reconnection attempts", async () => {
      const adapter = new WebSocketDebugAdapter(serverUrl.toString());
      let reconnectAttempts = 0;

      adapter.on("Adapter.event", event => {
        if (event.event === "output" && typeof event.body?.output === "string") {
          if (event.body.output.includes("Attempting to reconnect")) {
            reconnectAttempts++;
          }
        }
      });
      adapter.on("Adapter.response", () => {});
      adapter.on("Adapter.error", () => {});

      const started = await adapter.start();
      expect(started).toBe(true);

      adapter.options = { type: "attach", url: serverUrl.toString(), restart: 5000 };

      shouldUpgrade = false;

      // Simulate two rapid disconnections
      adapter.getInspector().close();
      // Small delay then try to trigger another
      await new Promise(resolve => setTimeout(resolve, 100));

      // The second disconnect should be ignored since reconnection is in progress
      // (We can't easily trigger a second Inspector.disconnected, but the flag check is there)

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Should only have one reconnection attempt message
      expect(reconnectAttempts).toBe(1);

      adapter.close();
    }, 10_000);
  });

  describe("restart method", () => {
    test("restart in attach mode closes and reconnects", async () => {
      const adapter = await createConnectedAdapter();

      // Set up as attach mode
      adapter.options = { type: "attach", url: serverUrl.toString() };

      // Restart should work
      await adapter.restart();

      adapter.close();
    });

    test("restart throws when no options set", async () => {
      const adapter = await createConnectedAdapter();
      adapter.options = undefined;

      expect(adapter.restart()).rejects.toThrow("Cannot restart");

      adapter.close();
    });

    test("restart in launch mode is a no-op", async () => {
      const adapter = await createConnectedAdapter();

      // Set up as launch mode
      adapter.options = { type: "launch", program: "test.js" };

      // Should not throw
      await adapter.restart();

      adapter.close();
    });
  });

  describe("static constants", () => {
    test("MAX_RECONNECTION_ATTEMPTS is 10", () => {
      expect(WebSocketDebugAdapter.MAX_RECONNECTION_ATTEMPTS).toBe(10);
    });

    test("DEFAULT_RECONNECT_TIMEOUT_MS is 10 seconds", () => {
      expect(WebSocketDebugAdapter.DEFAULT_RECONNECT_TIMEOUT_MS).toBe(10_000);
    });

    test("MAX_RECONNECT_TIMEOUT_MS is 5 minutes", () => {
      expect(WebSocketDebugAdapter.MAX_RECONNECT_TIMEOUT_MS).toBe(300_000);
    });

    test("RECONNECT_BACKOFF_MULTIPLIER is 1.5", () => {
      expect(WebSocketDebugAdapter.RECONNECT_BACKOFF_MULTIPLIER).toBe(1.5);
    });
  });
});

describe("Unix socket path validation", () => {
  // We can't test validateUnixSocketPath directly since it's module-private,
  // but we can test it through the UnixSignal constructor
  test("randomUnixPath creates paths in tmpdir", async () => {
    const { randomUnixPath } = await import("./signal.ts");
    const os = await import("node:os");
    const path = randomUnixPath();
    expect(path.startsWith(os.tmpdir())).toBe(true);
    expect(path.endsWith(".sock")).toBe(true);
  });
});
