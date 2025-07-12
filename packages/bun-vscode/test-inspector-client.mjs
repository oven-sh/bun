#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import WebSocket from "ws";

class UnixSignal {
  constructor() {
    this.path = `${tmpdir()}/${randomUUID()}.sock`;
    this.server = createServer();
    this.server.listen(this.path);

    this.server.on("connection", socket => {
      console.log("📡 Signal received from Bun!");
      this.emit("Signal.received");
      socket.end();
    });
  }

  get url() {
    return `unix://${this.path}`;
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

function testHttpConnection(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || 80,
      path: urlObj.pathname,
      method: "GET",
      headers: {
        "Connection": "Upgrade",
        "Upgrade": "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "x3JJHMbDL1EzLkh9GBhXDw==",
      },
    };

    console.log(`🔍 Testing HTTP connection to ${url}`);
    console.log(`🔍 Options:`, options);

    const req = http.request(options, res => {
      console.log(`🔍 HTTP Status: ${res.statusCode}`);
      console.log(`🔍 HTTP Headers:`, res.headers);
      resolve(res);
    });

    req.on("error", err => {
      console.log(`🔍 HTTP Error:`, err.message);
      reject(err);
    });

    req.on("upgrade", (res, socket, head) => {
      console.log(`🔍 HTTP Upgrade response:`, res.statusCode);
      resolve(res);
    });

    req.end();
  });
}

async function testInspectorAsClient() {
  console.log("🧪 Starting Bun Inspector Test (Client Mode)");

  // Create signal socket
  const signal = new UnixSignal();

  let inspectorUrl = null;
  let ws = null;
  let connectionAttempts = 0;

  // Start Bun test with --inspect-wait (no URL, let Bun choose)
  console.log("🏃 Starting Bun test process...");
  console.log("🔧 Signal URL:", signal.url);

  const proc = spawn("bun", ["--inspect-wait", "test", "../../test/package-json-lint.test.ts"], {
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
    const dataStr = data.toString().trim();
    console.log("📤 STDERR:", dataStr);

    // Look for the inspector URL
    if (dataStr.includes("ws://")) {
      const match = dataStr.match(/ws:\/\/[^\s\[\]]+/);
      if (match) {
        inspectorUrl = match[0];
        console.log("🎯 Found inspector URL:", inspectorUrl);
        console.log("🎯 URL length:", inspectorUrl.length);
        console.log(
          "🎯 URL chars:",
          Array.from(inspectorUrl).map(c => c.charCodeAt(0)),
        );

        // Wait a bit before trying to connect
        setTimeout(() => {
          connectToInspector(inspectorUrl);
        }, 100);
      }
    }
  });

  async function connectToInspector(url) {
    connectionAttempts++;
    console.log(`🔌 Connection attempt ${connectionAttempts}: Connecting to Bun inspector at: ${url}`);

    try {
      // First, test if the HTTP endpoint is accessible
      await testHttpConnection(url);
      console.log("✅ HTTP connection test passed");
    } catch (error) {
      console.log("❌ HTTP connection test failed:", error.message);

      // Try again after a delay
      if (connectionAttempts < 5) {
        console.log(`⏰ Waiting 1 second before retry...`);
        setTimeout(() => {
          connectToInspector(url);
        }, 1000);
        return;
      }
    }

    ws = new WebSocket(url, {
      headers: {
        "Ref-Event-Loop": "0",
      },
    });

    ws.on("open", () => {
      console.log("✅ Connected to Bun inspector!");

      // Skip initialization - try enabling domains directly
      console.log("📤 Enabling domains directly...");
      ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
      ws.send(JSON.stringify({ id: 2, method: "TestReporter.enable" }));
      ws.send(JSON.stringify({ id: 3, method: "LifecycleReporter.enable" }));
    });

    ws.on("message", data => {
      try {
        const message = JSON.parse(data.toString());
        console.log("📥 Received message:", JSON.stringify(message, null, 2));

        // Handle responses
        if (message.id && message.result !== undefined) {
          console.log(`✅ Response for ID ${message.id}:`, message.result);
        }

        // Handle errors
        if (message.id && message.error) {
          console.log(`❌ Error for ID ${message.id}:`, message.error);
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

    ws.on("error", error => {
      console.log("❌ WebSocket error:", error);

      // Try again after a delay
      if (connectionAttempts < 5) {
        console.log(`⏰ Waiting 1 second before retry...`);
        setTimeout(() => {
          connectToInspector(url);
        }, 1000);
      }
    });
  }

  // Setup signal listener
  signal.on("Signal.received", () => {
    console.log("📡 Signal received - Bun is ready!");
  });

  proc.on("close", code => {
    console.log(`🏁 Process exited with code: ${code}`);
    signal.close();
    if (ws) ws.close();
  });

  // Timeout after 15 seconds
  setTimeout(() => {
    console.log("⏰ Timeout reached, killing process");
    proc.kill();
    signal.close();
    if (ws) ws.close();
  }, 15000);
}

testInspectorAsClient().catch(console.error);
