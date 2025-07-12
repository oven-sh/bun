#!/usr/bin/env node

import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { WebSocketServer } from "ws";

async function getAvailablePort() {
  const server = createServer();
  server.listen(0);
  return new Promise(resolve => {
    server.on("listening", () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
  });
}

class UnixSignal {
  constructor() {
    this.url = `${tmpdir()}/${randomUUID()}.sock`;
    this.server = createServer();
    this.server.listen(this.url);

    this.server.on("connection", socket => {
      console.log("📡 Signal received from Bun!");
      this.emit("Signal.received");
      socket.end();
    });
  }

  emit(event) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(fn => fn());
    }
  }

  on(event, fn) {
    this.listeners = this.listeners || {};
    this.listeners[event] = this.listeners[event] || [];
    this.listeners[event].push(fn);
  }

  close() {
    this.server.close();
  }
}

async function testInspectorConnection() {
  console.log("🧪 Starting Bun Inspector Test");

  // Create WebSocket server
  const port = await getAvailablePort();
  const inspectorUrl = `ws://127.0.0.1:${port}`;

  const wss = new WebSocketServer({ port });
  console.log(`🚀 WebSocket server listening on ${inspectorUrl}`);

  // Create signal socket
  const signal = new UnixSignal();

  let connectedSocket = null;

  wss.on("connection", ws => {
    console.log("🔌 WebSocket connection established");
    connectedSocket = ws;

    // Try to send initialization immediately
    console.log("📤 Sending initialization immediately...");
    ws.send(
      JSON.stringify({
        id: 0,
        method: "Inspector.initialize",
        params: {
          adapterID: "bun-test-inspector",
          enableControlFlowProfiler: false,
          enableLifecycleAgentReporter: true,
          enableDebugger: false,
          sendImmediatePreventExit: false,
        },
      }),
    );

    ws.on("message", data => {
      try {
        const message = JSON.parse(data.toString());
        console.log("📥 Received message:", JSON.stringify(message, null, 2));

        // Handle initialization
        if (message.method === "Inspector.initialized") {
          console.log("🎯 Inspector initialized!");

          // Enable domains
          ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
          ws.send(JSON.stringify({ id: 2, method: "TestReporter.enable" }));
          ws.send(JSON.stringify({ id: 3, method: "LifecycleReporter.enable" }));
        }

        // Handle responses
        if (message.id && message.result !== undefined) {
          console.log(`✅ Response for ID ${message.id}:`, message.result);
        }

        // Handle test events
        if (message.method && message.method.startsWith("TestReporter.")) {
          console.log(`🎯 TEST EVENT: ${message.method}`, message.params);
        }

        if (message.method && message.method.startsWith("LifecycleReporter.")) {
          console.log(`🔥 LIFECYCLE EVENT: ${message.method}`, message.params);
        }
      } catch (error) {
        console.log("❌ Failed to parse message:", data.toString());
      }
    });

    ws.on("close", () => {
      console.log("🔌 WebSocket connection closed");
    });
  });

  // Setup signal listener
  signal.on("Signal.received", () => {
    console.log("📡 Signal received - Bun is ready!");

    // Send initialization message
    if (connectedSocket) {
      console.log("📤 Sending initialization...");
      connectedSocket.send(
        JSON.stringify({
          id: 0,
          method: "Inspector.initialize",
          params: {
            adapterID: "bun-test-inspector",
            enableControlFlowProfiler: false,
            enableLifecycleAgentReporter: true,
            enableDebugger: false,
            sendImmediatePreventExit: false,
          },
        }),
      );
    }
  });

  // Also listen for socket connections
  signal.on("Signal.Socket.connect", socket => {
    console.log("🔌 Socket connected to signal server");

    // Send initialization message
    if (connectedSocket) {
      console.log("📤 Sending initialization...");
      connectedSocket.send(
        JSON.stringify({
          id: 0,
          method: "Inspector.initialize",
          params: {
            adapterID: "bun-test-inspector",
            enableControlFlowProfiler: false,
            enableLifecycleAgentReporter: true,
            enableDebugger: false,
            sendImmediatePreventExit: false,
          },
        }),
      );
    }
  });

  // Start Bun test
  console.log("🏃 Starting Bun test process...");
  console.log("🔧 Inspector URL:", inspectorUrl);
  console.log("🔧 Signal URL:", signal.url);

  const proc = spawn("bun", ["--inspect-wait=" + inspectorUrl, "test", "../../test/package-json-lint.test.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BUN_INSPECT_NOTIFY: signal.url,
      BUN_DEBUG_QUIET_LOGS: "1",
      FORCE_COLOR: "1",
    },
  });

  proc.stdout.on("data", data => {
    console.log("📤 STDOUT:", data.toString().trim());
  });

  proc.stderr.on("data", data => {
    console.log("📤 STDERR:", data.toString().trim());
  });

  proc.on("close", code => {
    console.log(`🏁 Process exited with code: ${code}`);
    signal.close();
    wss.close();
  });

  // Timeout after 10 seconds
  setTimeout(() => {
    console.log("⏰ Timeout reached, killing process");
    proc.kill();
    signal.close();
    wss.close();
  }, 10000);
}

testInspectorConnection().catch(console.error);
