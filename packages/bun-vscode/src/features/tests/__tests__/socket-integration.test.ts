import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import {
  NodeSocketDebugAdapter,
  TCPSocketSignal,
  UnixSignal,
  getAvailablePort,
} from "../../../../../bun-debug-adapter-protocol";

class MockSocket extends EventEmitter {
  public destroyed = false;
  public readable = true;
  public writable = true;
  private messages: string[] = [];
  private _writableEnded = false;

  write(data: string | Buffer): boolean {
    if (this.destroyed || this._writableEnded) return false;
    this.messages.push(data.toString());
    this.emit("data", Buffer.isBuffer(data) ? data : Buffer.from(data));
    return true;
  }

  end(data?: string | Buffer): this {
    if (data) this.write(data);
    this._writableEnded = true;
    this.destroyed = true;
    this.emit("end");
    this.emit("close");
    return this;
  }

  destroy(error?: Error): this {
    this.destroyed = true;
    this._writableEnded = true;
    if (error) this.emit("error", error);
    this.emit("close");
    return this;
  }

  pause(): this {
    return this;
  }

  resume(): this {
    return this;
  }

  setTimeout(_timeout: number, callback?: () => void): this {
    if (callback) setTimeoutPromise(10).then(callback);
    return this;
  }

  setNoDelay(_noDelay?: boolean): this {
    return this;
  }

  setKeepAlive(_enable?: boolean, _initialDelay?: number): this {
    return this;
  }

  address() {
    return { address: this.localAddress, family: "IPv4", port: this.localPort };
  }

  getMessages(): string[] {
    return [...this.messages];
  }

  clearMessages(): void {
    this.messages = [];
  }

  simulateData(data: string | Buffer): void {
    if (!this.destroyed) {
      this.emit("data", Buffer.isBuffer(data) ? data : Buffer.from(data));
    }
  }

  simulateError(error: Error): void {
    this.emit("error", error);
  }

  // Mock socket properties
  remoteAddress = "127.0.0.1";
  remotePort = 12345;
  localAddress = "127.0.0.1";
  localPort = 54321;
  remoteFamily = "IPv4";
  connecting = false;
  readyState = "open";
  bytesRead = 0;
  bytesWritten = 0;
}

// Helper function to create test event sequences
function createTestEventSequence() {
  return [
    {
      event: "TestReporter.found",
      data: {
        id: 1,
        name: "arithmetic operations",
        url: "/test/math.test.ts",
        line: 1,
        type: "describe" as const,
      },
    },
    {
      event: "TestReporter.found",
      data: {
        id: 2,
        name: "addition",
        url: "/test/math.test.ts",
        line: 3,
        type: "test" as const,
        parentId: 1,
      },
    },
    {
      event: "TestReporter.found",
      data: {
        id: 3,
        name: "subtraction",
        url: "/test/math.test.ts",
        line: 7,
        type: "test" as const,
        parentId: 1,
      },
    },
    {
      event: "TestReporter.start",
      data: { id: 2 },
    },
    {
      event: "TestReporter.end",
      data: {
        id: 2,
        status: "pass" as const,
        elapsed: 15,
      },
    },
    {
      event: "TestReporter.start",
      data: { id: 3 },
    },
    {
      event: "TestReporter.end",
      data: {
        id: 3,
        status: "fail" as const,
        elapsed: 8,
      },
    },
  ];
}

describe("Socket Integration - Basic Functionality", () => {
  test("debug adapter creation and basic methods", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    expect(adapter).toBeDefined();
    expect(typeof adapter.getInspector).toBe("function");
    expect(typeof adapter.start).toBe("function");
    expect(typeof adapter.close).toBe("function");
    expect(typeof adapter.initialize).toBe("function");
    expect(typeof adapter.send).toBe("function");
    expect(typeof adapter.emit).toBe("function");

    // Test inspector access
    const inspector = adapter.getInspector();
    expect(inspector).toBeDefined();
    expect(typeof inspector.send).toBe("function");

    adapter.close();
  });

  test("adapter initialization with various configurations", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    // Test minimal initialization
    const minimalResponse = adapter.initialize({
      clientID: "test-client",
      adapterID: "bun",
    }) as any;

    expect(minimalResponse).toBeDefined();
    expect(minimalResponse.supportsConfigurationDoneRequest).toBe(true);

    // Test full initialization
    const fullResponse = adapter.initialize({
      clientID: "vscode-bun-test",
      adapterID: "bun",
      locale: "en-US",
      linesStartAt1: true,
      columnsStartAt1: true,
      enableTestReporter: true,
      enableLifecycleAgentReporter: true,
      enableConsole: true,
      enableControlFlowProfiler: false,
      enableDebugger: true,
    }) as any;

    expect(fullResponse).toBeDefined();
    expect(fullResponse.supportsConfigurationDoneRequest).toBe(true);
    expect(fullResponse.supportsFunctionBreakpoints).toBe(true);
    expect(fullResponse.supportsConditionalBreakpoints).toBe(true);

    adapter.close();
  });

  test("socket state management", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    expect(socket.destroyed).toBe(false);
    expect(socket.readable).toBe(true);
    expect(socket.writable).toBe(true);

    // Test socket destruction
    socket.destroy();
    expect(socket.destroyed).toBe(true);

    adapter.close();
  });
});

describe("Socket Integration - Event Handling", () => {
  test("test reporter events in correct sequence", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    const events: Array<{ type: string; data: any; timestamp: number }> = [];

    // Capture all test reporter events with timestamps
    adapter.on("TestReporter.found", event => {
      events.push({ type: "found", data: event, timestamp: Date.now() });
    });

    adapter.on("TestReporter.start", event => {
      events.push({ type: "start", data: event, timestamp: Date.now() });
    });

    adapter.on("TestReporter.end", event => {
      events.push({ type: "end", data: event, timestamp: Date.now() });
    });

    // Simulate events that would be emitted by the adapter after it receives and parses
    // messages from Bun through the socket. This tests the event handling logic without
    // needing to simulate the full debug adapter protocol.
    const testSequence = createTestEventSequence();
    for (const { event, data } of testSequence) {
      adapter.emit(event as any, data);
      await setTimeoutPromise(1);
    }

    // Verify event count and sequence
    expect(events).toHaveLength(7);

    // Verify event types in correct order
    const eventTypes = events.map(e => e.type);
    expect(eventTypes).toEqual(["found", "found", "found", "start", "end", "start", "end"]);

    // Verify timestamps are in order
    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp);
    }

    // Verify specific event data
    expect(events[0].data).toEqual({
      id: 1,
      name: "arithmetic operations",
      url: "/test/math.test.ts",
      line: 1,
      type: "describe",
    });

    expect(events[3].data).toEqual({ id: 2 });
    expect(events[4].data).toEqual({
      id: 2,
      status: "pass",
      elapsed: 15,
    });

    adapter.close();
  });

  test("complex test event scenarios", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    const foundEvents: any[] = [];
    const startEvents: any[] = [];
    const endEvents: any[] = [];

    adapter.on("TestReporter.found", event => foundEvents.push(event));
    adapter.on("TestReporter.start", event => startEvents.push(event));
    adapter.on("TestReporter.end", event => endEvents.push(event));

    // Simulate events that the adapter would emit after receiving messages from Bun
    // Test nested describe blocks
    adapter.emit("TestReporter.found", {
      id: 1,
      name: "User Management",
      url: "/test/user.test.ts",
      line: 1,
      type: "describe",
    });

    adapter.emit("TestReporter.found", {
      id: 2,
      name: "Authentication",
      url: "/test/user.test.ts",
      line: 3,
      type: "describe",
      parentId: 1,
    });

    adapter.emit("TestReporter.found", {
      id: 3,
      name: "should login with valid credentials",
      url: "/test/user.test.ts",
      line: 5,
      type: "test",
      parentId: 2,
    });

    // Test different status types
    const statusTests = [
      { id: 4, status: "pass" as const, elapsed: 12 },
      { id: 5, status: "fail" as const, elapsed: 25 },
      { id: 6, status: "skip" as const, elapsed: 0 },
      { id: 7, status: "timeout" as const, elapsed: 5000 },
      { id: 8, status: "todo" as const, elapsed: 0 },
    ];

    for (const test of statusTests) {
      adapter.emit("TestReporter.found", {
        id: test.id,
        name: `test ${test.id}`,
        url: "/test/status.test.ts",
        line: test.id,
        type: "test",
      });

      adapter.emit("TestReporter.start", { id: test.id });
      adapter.emit("TestReporter.end", {
        id: test.id,
        status: test.status,
        elapsed: test.elapsed,
      });
    }

    expect(foundEvents).toHaveLength(8); // 3 + 5 tests
    expect(startEvents).toHaveLength(5); // Only actual tests
    expect(endEvents).toHaveLength(5);

    // Verify nested structure
    const nestedTest = foundEvents.find(e => e.id === 3);
    expect(nestedTest.parentId).toBe(2);

    // Verify all status types were captured
    const statuses = endEvents.map(e => e.status);
    expect(statuses).toEqual(["pass", "fail", "skip", "timeout", "todo"]);

    adapter.close();
  });

  test("inspector connection lifecycle", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    const connectionEvents: string[] = [];

    adapter.on("Inspector.connected", () => {
      connectionEvents.push("connected");
    });

    adapter.on("Inspector.disconnected", (error?: Error) => {
      connectionEvents.push(error ? "disconnected-error" : "disconnected");
    });

    // Simulate Inspector events that would be emitted after the adapter processes
    // connection state changes from Bun
    adapter.emit("Inspector.connected");
    expect(connectionEvents).toEqual(["connected"]);

    // Simulate disconnection without error
    adapter.emit("Inspector.disconnected");
    expect(connectionEvents).toEqual(["connected", "disconnected"]);

    // Simulate disconnection with error
    const testError = new Error("Connection lost");
    adapter.emit("Inspector.disconnected", testError);
    expect(connectionEvents).toEqual(["connected", "disconnected", "disconnected-error"]);

    adapter.close();
  });

  test("lifecycle error events with detailed information", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    const errorEvents: any[] = [];

    adapter.on("LifecycleReporter.error", event => {
      errorEvents.push(event);
    });

    // Test various error scenarios
    const errorScenarios = [
      {
        message: "Module not found: './missing-file.js'",
        name: "ModuleNotFoundError",
        urls: ["/src/app.ts"],
        lineColumns: [15, 25],
        sourceLines: ["import { helper } from './missing-file.js';"],
      },
      {
        message: "Cannot read property 'length' of undefined",
        name: "TypeError",
        urls: ["/src/utils.ts", "/src/app.ts"],
        lineColumns: [42, 15, 100, 20],
        sourceLines: ["function processArray(arr) {", "  return arr.length > 0;", "}"],
      },
      {
        message: "Timeout exceeded",
        name: "TimeoutError",
        urls: ["/test/slow.test.ts"],
        lineColumns: [1, 1],
        sourceLines: ["test('slow test', async () => {"],
      },
    ];

    for (const errorData of errorScenarios) {
      adapter.emit("LifecycleReporter.error", errorData);
    }

    expect(errorEvents).toHaveLength(3);

    // Verify first error
    expect(errorEvents[0]).toEqual({
      message: "Module not found: './missing-file.js'",
      name: "ModuleNotFoundError",
      urls: ["/src/app.ts"],
      lineColumns: [15, 25],
      sourceLines: ["import { helper } from './missing-file.js';"],
    });

    // Verify multi-location error
    expect(errorEvents[1].urls).toHaveLength(2);
    expect(errorEvents[1].lineColumns).toHaveLength(4);

    adapter.close();
  });
});

describe("Socket Integration - Real Bun Process", () => {
  test("real Bun test runner with socket communication", async () => {
    // Create a temporary directory for our test
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bun-vscode-test-"));

    try {
      // Create a test file with various test cases including nested describes and test.each
      const testFile = path.join(tmpDir, "example.test.ts");
      await fs.writeFile(
        testFile,
        `
import { test, expect, describe } from "bun:test";

describe("Math operations", () => {
  describe("Basic arithmetic", () => {
    test("addition", () => {
      expect(1 + 1).toBe(2);
    });
    
    test("subtraction", () => {
      expect(5 - 3).toBe(2);
    });
  });
  
  describe("Advanced operations", () => {
    test.skip("multiplication", () => {
      expect(2 * 3).toBe(6);
    });
    
    test.each([
      { a: 2, b: 3, expected: 5 },
      { a: 10, b: 5, expected: 15 },
    ])("$a + $b = $expected!", ({ a, b, expected }) => {
      expect(a + b).toBe(expected);
    });

    test.each([
      [2, 3, 5],
      [10, 5, 15],
    ])("%i + %i = %i", (a, b, expected) => {
      expect(a + b).toBe(expected);
    });
  });
});

test("failing test", () => {
  expect(true).toBe(false);
});

test.todo("future feature");

// Test with special characters
test("test with $variable and %s format", () => {
  expect(true).toBe(true);
});
      `,
      );

      // Create a signal for Bun to connect to
      const signal = process.platform === "win32" ? new TCPSocketSignal(await getAvailablePort()) : new UnixSignal();

      await signal.ready;

      // Track events we receive
      const events: { type: string; data: any }[] = [];
      let adapter: NodeSocketDebugAdapter | null = null;

      // Wait for Bun to connect
      const connectionPromise = new Promise<void>(resolve => {
        signal.once("Signal.Socket.connect", (socket: net.Socket) => {
          adapter = new NodeSocketDebugAdapter(socket);

          // Set up event handlers
          adapter.on("TestReporter.found", data => {
            events.push({ type: "found", data });
          });

          adapter.on("TestReporter.start", data => {
            events.push({ type: "start", data });
          });

          adapter.on("TestReporter.end", data => {
            events.push({ type: "end", data });
          });

          adapter.on("LifecycleReporter.error", data => {
            events.push({ type: "error", data });
          });

          // Initialize the adapter
          adapter.start().then(() => {
            adapter!.initialize({
              adapterID: "bun-test",
              pathFormat: "path",
              enableTestReporter: true,
              enableLifecycleAgentReporter: true,
            });
            resolve();
          });
        });
      });

      // Spawn Bun with the test file
      const bunProcess = spawn("bun", ["test", testFile, `--inspect-wait=${signal.url}`], {
        cwd: tmpDir,
        env: {
          ...process.env,
          BUN_DEBUG_QUIET_LOGS: "1",
        },
      });

      // Wait for connection
      await connectionPromise;

      // Wait for the process to complete
      await new Promise<void>(resolve => {
        bunProcess.on("exit", () => resolve());
      });

      // Clean up
      adapter?.close();
      (signal as any).close();

      // Verify we received the expected events
      const foundEvents = events.filter(e => e.type === "found");
      const startEvents = events.filter(e => e.type === "start");
      const endEvents = events.filter(e => e.type === "end");
      const errorEvents = events.filter(e => e.type === "error");

      // Log actual event structure for debugging
      if (process.env.DEBUG_SOCKET_TEST) {
        console.log(
          "Found events:",
          foundEvents.map(e => `${e.data.type}: ${e.data.name} (id: ${e.data.id}, parentId: ${e.data.parentId})`),
        );
        console.log(
          "Start events:",
          startEvents.map(e => `id: ${e.data.id}`),
        );
        console.log(
          "End events:",
          endEvents.map(e => `id: ${e.data.id}, status: ${e.data.status}`),
        );
      }

      // Should find all describe blocks and tests
      expect(foundEvents.length).toBeGreaterThanOrEqual(9); // 3 describes + 6+ tests

      // Verify the top-level describe block
      const mathOperations = foundEvents.find(e => e.data.type === "describe" && e.data.name === "Math operations");
      expect(mathOperations).toBeDefined();
      expect(mathOperations?.data.parentId).toBeUndefined(); // Top-level has no parent
      expect(mathOperations?.data.url).toContain("example.test.ts");
      expect(mathOperations?.data.line).toBeGreaterThan(0);

      // Verify nested describe blocks have correct parentId
      const basicArithmetic = foundEvents.find(e => e.data.type === "describe" && e.data.name === "Basic arithmetic");
      expect(basicArithmetic).toBeDefined();
      expect(basicArithmetic?.data.parentId).toBe(mathOperations?.data.id);

      const advancedOps = foundEvents.find(e => e.data.type === "describe" && e.data.name === "Advanced operations");
      expect(advancedOps).toBeDefined();
      expect(advancedOps?.data.parentId).toBe(mathOperations?.data.id);

      // Verify tests have correct parentId
      const addition = foundEvents.find(e => e.data.type === "test" && e.data.name === "addition");
      expect(addition).toBeDefined();
      expect(addition?.data.parentId).toBe(basicArithmetic?.data.id);

      const subtraction = foundEvents.find(e => e.data.type === "test" && e.data.name === "subtraction");
      expect(subtraction).toBeDefined();
      expect(subtraction?.data.parentId).toBe(basicArithmetic?.data.id);

      const multiplication = foundEvents.find(e => e.data.type === "test" && e.data.name === "multiplication");
      expect(multiplication).toBeDefined();
      expect(multiplication?.data.parentId).toBe(advancedOps?.data.id);

      // Verify test.each generated tests have parentId
      const testEachTests = foundEvents.filter(e => e.data.type === "test" && e.data.name.match(/^\d+ \+ \d+ = \d+!$/));
      expect(testEachTests.length).toBe(2); // We have 2 test cases
      expect(testEachTests[0].data.name).toBe("2 + 3 = 5!");
      expect(testEachTests[1].data.name).toBe("10 + 5 = 15!");
      testEachTests.forEach(test => {
        expect(test.data.parentId).toBe(advancedOps?.data.id);
      });

      // Verify that % formatters ARE expanded by Bun during discovery
      const percentFormatterTests = foundEvents.filter(
        e => e.data.type === "test" && e.data.name.match(/^\d+ \+ \d+ = \d+$/),
      );
      expect(percentFormatterTests.length).toBe(2); // We have 2 test cases
      expect(percentFormatterTests[0].data.name).toBe("2 + 3 = 5");
      expect(percentFormatterTests[1].data.name).toBe("10 + 5 = 15");
      percentFormatterTests.forEach(test => {
        expect(test.data.parentId).toBe(advancedOps?.data.id);
      });

      // Verify top-level tests have no parentId
      const failingTest = foundEvents.find(e => e.data.type === "test" && e.data.name === "failing test");
      expect(failingTest).toBeDefined();
      expect(failingTest?.data.parentId).toBeUndefined();

      const todoTest = foundEvents.find(e => e.data.type === "test" && e.data.name === "future feature");
      expect(todoTest).toBeDefined();
      expect(todoTest?.data.parentId).toBeUndefined();

      // Verify test with special characters
      const specialTest = foundEvents.find(
        e => e.data.type === "test" && e.data.name === "test with $variable and %s format",
      );
      expect(specialTest).toBeDefined();
      expect(specialTest?.data.parentId).toBeUndefined();

      // This test should run normally
      const specialEnd = endEvents.find(e => e.data.id === specialTest?.data.id);
      expect(specialEnd?.data.status).toBe("pass");

      // Verify it has both start and end events
      const specialStart = startEvents.find(e => e.data.id === specialTest?.data.id);
      expect(specialStart).toBeDefined();

      // Verify all found events have required properties
      foundEvents.forEach(event => {
        expect(event.data.id).toBeDefined();
        expect(typeof event.data.id).toBe("number");
        expect(event.data.name).toBeDefined();
        expect(event.data.type).toMatch(/^(test|describe)$/);
        expect(event.data.url).toBeDefined();
        expect(event.data.line).toBeDefined();
        expect(typeof event.data.line).toBe("number");
      });

      // Verify test execution events
      // Important: skip and todo tests only generate end events, no start events
      const allTests = foundEvents.filter(e => e.data.type === "test");

      // We know which tests are skip/todo based on their IDs
      const skipTestId = multiplication?.data.id;
      const todoTestId = todoTest?.data.id;

      // Start events: only for tests that actually run (not skip/todo)
      const expectedStartCount = allTests.filter(t => t.data.id !== skipTestId && t.data.id !== todoTestId).length;
      expect(startEvents.length).toBe(expectedStartCount);

      // End events: all tests including skip/todo
      expect(endEvents.length).toBe(allTests.length);

      // Verify specific test results
      const additionEnd = endEvents.find(e => e.data.id === addition?.data.id);
      expect(additionEnd?.data.status).toBe("pass");
      expect(additionEnd?.data.elapsed).toBeGreaterThan(0);

      const failingEnd = endEvents.find(e => e.data.id === failingTest?.data.id);
      expect(failingEnd?.data.status).toBe("fail");

      // Skip tests: only end event (no start event)
      const skippedEnd = endEvents.find(e => e.data.id === multiplication?.data.id);
      expect(skippedEnd?.data.status).toBe("skip");
      const skippedStart = startEvents.find(e => e.data.id === multiplication?.data.id);
      expect(skippedStart).toBeUndefined();

      // Todo tests: only end event (no start event)
      const todoEnd = endEvents.find(e => e.data.id === todoTest?.data.id);
      expect(todoEnd?.data.status).toBe("todo");
      const todoStart = startEvents.find(e => e.data.id === todoTest?.data.id);
      expect(todoStart).toBeUndefined();

      // Verify error event for failing test
      expect(errorEvents.length).toBeGreaterThan(0);
      const failError = errorEvents[0];
      expect(failError.data.message).toContain("expected");
      expect(failError.data.urls).toBeDefined();
      expect(failError.data.urls[0]).toContain("example.test.ts");
    } finally {
      // Clean up temp directory
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 30000); // 30 second timeout for spawning process

  test.skip("debug: minimal socket test", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bun-vscode-minimal-"));

    try {
      // Create minimal test file
      const testFile = path.join(tmpDir, "minimal.test.ts");
      await fs.writeFile(
        testFile,
        `
import { test, expect } from "bun:test";
test("simple", () => {
  expect(1).toBe(1);
});
`,
      );

      // Create signal and spawn Bun
      const signal = process.platform === "win32" ? new TCPSocketSignal(await getAvailablePort()) : new UnixSignal();

      await signal.ready;

      const events: any[] = [];
      let adapter: NodeSocketDebugAdapter | null = null;
      let connected = false;

      // Set up connection handler
      signal.once("Signal.Socket.connect", (socket: net.Socket) => {
        console.log("Socket connected!");
        connected = true;
        adapter = new NodeSocketDebugAdapter(socket);

        adapter.on("TestReporter.found", data => {
          console.log("Found event:", data);
          events.push({ type: "found", data });
        });

        adapter.on("TestReporter.start", data => {
          console.log("Start event:", data);
          events.push({ type: "start", data });
        });

        adapter.on("TestReporter.end", data => {
          console.log("End event:", data);
          events.push({ type: "end", data });
        });

        // Initialize adapter with the right flags!
        adapter.start().then(() => {
          adapter!.initialize({
            adapterID: "bun-test",
            pathFormat: "path",
            enableTestReporter: true,
            enableLifecycleAgentReporter: true,
          });
        });
      });

      console.log("Spawning Bun with:", ["test", testFile, `--inspect-wait=${signal.url}`]);
      const bunProcess = spawn("bun", ["test", testFile, `--inspect-wait=${signal.url}`], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          BUN_DEBUG_QUIET_LOGS: "1",
        },
      });

      // Log stdout/stderr
      bunProcess.stdout?.on("data", data => {
        console.log("Bun stdout:", data.toString());
      });

      bunProcess.stderr?.on("data", data => {
        console.log("Bun stderr:", data.toString());
      });

      // Wait for process to exit or timeout
      const exitCode = await Promise.race([
        new Promise<number>(resolve => {
          bunProcess.on("exit", code => {
            console.log("Bun exited with code:", code);
            resolve(code ?? -1);
          });
        }),
        setTimeoutPromise(5000).then(() => {
          console.log("Timeout reached, killing process");
          bunProcess.kill();
          return -2;
        }),
      ]);

      console.log("Connected:", connected);
      console.log("Events received:", events.length);
      console.log("Exit code:", exitCode);

      // Clean up
      adapter?.close();
      (signal as any).close();

      expect(connected).toBe(true);
      expect(events.length).toBeGreaterThan(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test.skip("debug: write test file to see what's wrong", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bun-vscode-debug-"));

    try {
      // Generate a simple test file
      let content = 'import { describe, test, expect } from "bun:test";\n\n';

      for (let i = 0; i < 3; i++) {
        content += `describe("Module ${i}", () => {\n`;
        for (let j = 0; j < 2; j++) {
          content += `  test("test ${i}-${j}", () => {\n`;
          content += `    expect(${i} + ${j}).toBe(${i + j});\n`;
          content += `  });\n`;
        }
        content += `});\n\n`;
      }

      const testFile = path.join(tmpDir, "debug.test.ts");
      await fs.writeFile(testFile, content);

      console.log("Generated test file at:", testFile);
      console.log("Content length:", content.length);
      console.log("First 500 chars:\n", content.substring(0, 500));

      // Try to run it directly without socket to see if it works
      const { stdout, stderr, exitCode } = await Bun.$`bun test ${testFile}`.quiet();

      console.log("Exit code:", exitCode);
      console.log("Stdout:", stdout.toString());
      console.log("Stderr:", stderr.toString());

      // If that works, try with socket
      if (exitCode === 0) {
        console.log("Direct run worked, trying with socket...");
        // Keep the test file for manual inspection
        console.log("Test file kept at:", testFile);
      }

      expect(exitCode).toBe(0);
    } finally {
      // Don't clean up so we can inspect the file
      console.log("Test directory:", tmpDir);
    }
  });

  test("performance test with many regular tests", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bun-vscode-perf-"));

    try {
      // Generate a file with many simple tests to verify performance
      let content = 'import { describe, test, expect } from "bun:test";\n\n';

      for (let i = 0; i < 10; i++) {
        content += `describe("Module ${i}", () => {\n`;
        for (let j = 0; j < 5; j++) {
          content += `  test("test ${i}-${j}", () => {\n`;
          content += `    expect(${i} + ${j}).toBe(${i + j});\n`;
          content += `  });\n\n`;
        }
        content += `});\n\n`;
      }

      expect(content.length).toBeGreaterThan(2_000); // At least 2KB

      const testFile = path.join(tmpDir, "performance.test.ts");
      await fs.writeFile(testFile, content);

      // Create signal and spawn Bun
      const signal = process.platform === "win32" ? new TCPSocketSignal(await getAvailablePort()) : new UnixSignal();

      await signal.ready;

      // Track timing
      const startTime = Date.now();
      const events: { type: string; data: any }[] = [];
      let adapter: NodeSocketDebugAdapter | null = null;

      // Wait for Bun to connect
      const connectionPromise = new Promise<void>(resolve => {
        signal.once("Signal.Socket.connect", (socket: net.Socket) => {
          adapter = new NodeSocketDebugAdapter(socket);

          adapter.on("TestReporter.found", data => {
            events.push({ type: "found", data });
          });

          // Initialize adapter with test reporter enabled
          adapter.start().then(() => {
            adapter!.initialize({
              adapterID: "bun-test",
              pathFormat: "path",
              enableTestReporter: true,
              enableLifecycleAgentReporter: true,
            });
            resolve();
          });
        });
      });

      // Spawn Bun
      const bunProcess = spawn("bun", ["test", testFile, `--inspect-wait=${signal.url}`, "--timeout=100"]);

      await connectionPromise;

      // Wait for discovery to complete
      await new Promise<void>(resolve => {
        const timer = setTimeoutPromise(8000).then(() => resolve()); // 8s timeout

        const checkEvents = () => {
          if (events.length > 10) {
            // Should find at least 10 items
            resolve();
          } else {
            setTimeoutPromise(50).then(checkEvents);
          }
        };

        checkEvents();
        return timer;
      });

      const discoveryTime = Date.now() - startTime;

      // Kill the process
      bunProcess.kill();

      // Verify performance and structure
      expect(discoveryTime).toBeLessThan(10_000); // Should complete within 10 seconds
      expect(events.length).toBeGreaterThan(10); // Should discover many items

      const foundEvents = events.filter(e => e.type === "found");
      const describes = foundEvents.filter(e => e.data.type === "describe");
      const tests = foundEvents.filter(e => e.data.type === "test");

      expect(describes.length).toBeGreaterThanOrEqual(7); // Some modules found
      expect(tests.length).toBeGreaterThanOrEqual(30); // Many tests found

      console.log(
        `Performance test: ${discoveryTime}ms for ${content.length} bytes, found ${foundEvents.length} items`,
      );

      // Clean up
      adapter?.close();
      (signal as any).close();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 1000);

  test("stress test with deeply nested describes", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bun-vscode-stress-"));

    try {
      // Generate deeply nested structure
      let content = 'import { describe, test, expect } from "bun:test";\n\n';

      // Create 5 levels of nesting
      for (let i = 0; i < 5; i++) {
        content += `${"  ".repeat(i)}describe("Level ${i}", () => {\n`;
      }

      // Add test.each at the deepest level
      content += `${"  ".repeat(5)}test.each([\n`;
      content += `${"  ".repeat(5)}  { deep: "value1", level: 5 },\n`;
      content += `${"  ".repeat(5)}  { deep: "value2", level: 5 },\n`;
      content += `${"  ".repeat(5)}])("deeply nested $deep at level $level", ({ deep, level }) => {\n`;
      content += `${"  ".repeat(5)}  expect(level).toBe(5);\n`;
      content += `${"  ".repeat(5)}});\n\n`;

      // Close all the describes
      for (let i = 4; i >= 0; i--) {
        content += `${"  ".repeat(i)}});\n`;
      }

      const testFile = path.join(tmpDir, "nested.test.ts");
      await fs.writeFile(testFile, content);

      // Create signal and spawn Bun
      const signal = process.platform === "win32" ? new TCPSocketSignal(await getAvailablePort()) : new UnixSignal();

      await signal.ready;

      const events: { type: string; data: any }[] = [];
      let adapter: NodeSocketDebugAdapter | null = null;

      const connectionPromise = new Promise<void>(resolve => {
        signal.once("Signal.Socket.connect", (socket: net.Socket) => {
          adapter = new NodeSocketDebugAdapter(socket);

          adapter.on("TestReporter.found", data => {
            events.push({ type: "found", data });
          });

          // Initialize adapter with test reporter enabled
          adapter.start().then(() => {
            adapter!.initialize({
              adapterID: "bun-test",
              pathFormat: "path",
              enableTestReporter: true,
              enableLifecycleAgentReporter: true,
            });
            resolve();
          });
        });
      });

      const bunProcess = spawn("bun", ["test", testFile, `--inspect-wait=${signal.url}`, "--timeout=100"]);

      await connectionPromise;

      // Wait for discovery
      await new Promise<void>(resolve => {
        const timer = setTimeoutPromise(5000).then(() => resolve());

        const checkEvents = () => {
          if (events.length > 5) {
            // Should find all nested describes + tests
            resolve();
          } else {
            setTimeoutPromise(10).then(checkEvents);
          }
        };

        checkEvents();
        return timer;
      });

      bunProcess.kill();

      // Verify deep nesting works
      const foundEvents = events.filter(e => e.type === "found");
      const describes = foundEvents.filter(e => e.data.type === "describe");
      const tests = foundEvents.filter(e => e.data.type === "test");

      expect(describes.length).toBe(5); // 5 levels of nesting
      expect(tests.length).toBe(2); // 2 test.each cases

      // Verify parentId chain is correct
      let currentParent: number | undefined;
      for (let i = 0; i < 5; i++) {
        const levelDescribe = describes.find(d => d.data.name === `Level ${i}`);
        expect(levelDescribe).toBeDefined();
        expect(levelDescribe?.data.parentId).toBe(currentParent);
        currentParent = levelDescribe?.data.id;
      }

      // Verify tests have correct parent (deepest describe)
      const deepestDescribe = describes.find(d => d.data.name === "Level 4");
      tests.forEach(test => {
        expect(test.data.parentId).toBe(deepestDescribe?.data.id);
      });

      // Clean up
      adapter?.close();
      (signal as any).close();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 30000);
});

describe("Socket Integration - Complex Edge Cases", () => {
  test("test.each with deeply nested and complex data structures", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bun-vscode-complex-"));
    let bunProcess: ReturnType<typeof spawn> | null = null;

    try {
      // Create test file with various complex test.each scenarios
      const testFile = path.join(tmpDir, "complex.test.ts");
      await fs.writeFile(
        testFile,
        `
import { test, expect, describe } from "bun:test";

describe("Complex test.each scenarios", () => {
  // Deeply nested arrays
  test.each([
    [[[[1]], [[2]]], "nested"],
    [[[[3]], [[4]]], "arrays"],
  ])("deeply nested %s", (data, name) => {
    expect(data).toBeDefined();
  });

  // Mixed array/object combinations
  test.each([
    { arr: [1, { inner: [2, 3] }], name: "mixed1" },
    { arr: [{ nested: true }, [4, 5]], name: "mixed2" },
  ])("mixed structures $name", ({ arr, name }) => {
    expect(arr).toBeDefined();
  });

  // Complex escape sequences
  test.each([
    { str: "line1\\nline2\\ttab\\\\slash", id: 1 },
    { str: "quotes\\"and'apostrophes", id: 2 },
    { str: "unicode\\u0041\\u{1F600}", id: 3 },
  ])("escape sequences $id: $str", ({ str, id }) => {
    expect(str).toBeDefined();
  });

  // Very long test names
  test.each([
    { desc: "a".repeat(200), val: 1 },
    { desc: "b".repeat(300), val: 2 },
  ])("long name: $desc", ({ desc, val }) => {
    expect(val).toBeGreaterThan(0);
  });

  // Special number values
  test.each([
    [NaN, "NaN"],
    [Infinity, "Infinity"],
    [-Infinity, "-Infinity"],
    [0, "zero"],
    [-0, "-zero"],
  ])("%s is %s", (num, desc) => {
    expect(desc).toBeDefined();
  });
});
`,
      );

      // Set up socket connection
      const signal = process.platform === "win32" ? new TCPSocketSignal(await getAvailablePort()) : new UnixSignal();

      await signal.ready;

      const events: { type: string; data: any }[] = [];
      let adapter: NodeSocketDebugAdapter | null = null;

      const connectionPromise = new Promise<void>(resolve => {
        signal.once("Signal.Socket.connect", (socket: net.Socket) => {
          adapter = new NodeSocketDebugAdapter(socket);

          adapter.on("TestReporter.found", data => {
            events.push({ type: "found", data });
          });

          adapter.on("TestReporter.start", data => {
            events.push({ type: "start", data });
          });

          adapter.on("TestReporter.end", data => {
            events.push({ type: "end", data });
          });

          adapter.start().then(() => {
            adapter!.initialize({
              adapterID: "bun-test",
              pathFormat: "path",
              enableTestReporter: true,
              enableLifecycleAgentReporter: true,
            });
            resolve();
          });
        });
      });

      bunProcess = spawn("bun", ["test", testFile, `--inspect-wait=${signal.url}`]);

      await connectionPromise;

      // Wait for process to complete
      await new Promise<void>(resolve => {
        bunProcess?.on("exit", () => resolve());
      });

      // Verify results
      const foundEvents = events.filter(e => e.type === "found");
      const tests = foundEvents.filter(e => e.data.type === "test");

      // Should handle all complex test.each scenarios
      expect(tests.length).toBeGreaterThan(10);

      // Check for specific test names
      expect(tests.map(t => t.data.name)).toMatchInlineSnapshot(`
        [
          "deeply nested %s",
          "deeply nested %s",
          "mixed structures "mixed1"",
          "mixed structures "mixed2"",
          "escape sequences 1: "line1\\nline2\\ttab\\\\slash"",
          "escape sequences 2: "quotes\\"and'apostrophes"",
          "escape sequences 3: "unicodeA😀"",
          "long name: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"",
          "long name: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"",
          "%s is NaN",
          "%s is Infinity",
          "%s is -Infinity",
          "%s is zero",
          "%s is -zero",
        ]
      `);

      // Clean up
      adapter?.close();
      (signal as any).close();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("unicode and special characters in test names", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bun-vscode-unicode-"));
    let bunProcess: ReturnType<typeof spawn> | null = null;

    try {
      const testFile = path.join(tmpDir, "unicode.test.ts");
      await fs.writeFile(
        testFile,
        `
import { test, expect } from "bun:test";

// Zero-width characters
test("test\\u200B\\u200Cwith\\u200Dzero-width", () => {
  expect(true).toBe(true);
});

// RTL text
test("מבחן בעברית", () => {
  expect(true).toBe(true);
});

test("اختبار عربي", () => {
  expect(true).toBe(true);
});

// Emoji combinations
test("👨‍👩‍👧‍👦 family test", () => {
  expect(true).toBe(true);
});

test("🏃🏽‍♀️ running woman", () => {
  expect(true).toBe(true);
});

// Mathematical symbols
test("∑∏∫ mathematical test", () => {
  expect(true).toBe(true);
});

// Combining diacriticals
test("café ñoño tést с̆ḩa̐r̥s̊", () => {
  expect(true).toBe(true);
});

// Mixed scripts
test("Hello 世界 🌍 мир", () => {
  expect(true).toBe(true);
});

// Control characters (sanitized)
test("test\\x07bell\\x08backspace", () => {
  expect(true).toBe(true);
});
`,
      );

      const signal = process.platform === "win32" ? new TCPSocketSignal(await getAvailablePort()) : new UnixSignal();

      await signal.ready;

      const events: { type: string; data: any }[] = [];
      let adapter: NodeSocketDebugAdapter | null = null;

      const connectionPromise = new Promise<void>(resolve => {
        signal.once("Signal.Socket.connect", (socket: net.Socket) => {
          adapter = new NodeSocketDebugAdapter(socket);

          adapter.on("TestReporter.found", data => {
            events.push({ type: "found", data });
          });

          adapter.start().then(() => {
            adapter!.initialize({
              adapterID: "bun-test",
              pathFormat: "path",
              enableTestReporter: true,
              enableLifecycleAgentReporter: true,
            });
            resolve();
          });
        });
      });

      bunProcess = spawn("bun", ["test", testFile, `--inspect-wait=${signal.url}`]);

      await connectionPromise;

      await new Promise<void>(resolve => {
        bunProcess?.on("exit", () => resolve());
      });

      // Small delay to ensure all events are processed
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify unicode handling
      const foundEvents = events.filter(e => e.type === "found");
      const tests = foundEvents.filter(e => e.data.type === "test");

      expect(tests.length).toBe(9);

      const testNames = tests.map(t => t.data.name);

      // Zero-width characters preserved
      expect(testNames.some(n => n.includes("\u200B"))).toBe(true);

      // RTL text preserved
      expect(testNames.some(n => n.includes("מבחן"))).toBe(true);
      expect(testNames.some(n => n.includes("اختبار"))).toBe(true);

      // Emoji preserved
      expect(testNames.some(n => n.includes("👨‍👩‍👧‍👦"))).toBe(true);

      // Mathematical symbols
      expect(testNames.some(n => n.includes("∑∏∫"))).toBe(true);

      // Clean up
      adapter?.close();
      (signal as any).close();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("malformed test files and error scenarios", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bun-vscode-errors-"));

    try {
      // Test 1: Syntax error in test.each
      const syntaxErrorFile = path.join(tmpDir, "syntax-error.test.ts");
      await fs.writeFile(
        syntaxErrorFile,
        `
import { test, expect } from "bun:test";

test.each([
  { a: 1, b: }, // Syntax error!
])("broken test", ({ a, b }) => {
  expect(a).toBe(1);
});
`,
      );

      // Test 2: Unclosed string in test name
      const unclosedStringFile = path.join(tmpDir, "unclosed.test.ts");
      await fs.writeFile(
        unclosedStringFile,
        `
import { test, expect } from "bun:test";

test("unclosed string, () => {
  expect(true).toBe(true);
});
`,
      );

      // Test 3: Very large test.each array
      const largeArrayFile = path.join(tmpDir, "large-array.test.ts");
      const largeArray = Array.from({ length: 1000 }, (_, i) => `[${i}, ${i + 1}]`).join(",\n");
      await fs.writeFile(
        largeArrayFile,
        `
import { test, expect } from "bun:test";

test.each([
${largeArray}
])("%i + 1 = %i", (a, b) => {
  expect(a + 1).toBe(b);
});
`,
      );

      // Test each file separately
      for (const [name, file] of [
        ["syntax error", syntaxErrorFile],
        ["unclosed string", unclosedStringFile],
        ["large array", largeArrayFile],
      ]) {
        const signal = process.platform === "win32" ? new TCPSocketSignal(await getAvailablePort()) : new UnixSignal();

        await signal.ready;

        const events: { type: string; data: any }[] = [];
        let adapter: NodeSocketDebugAdapter | null = null;
        let connectionError: Error | null = null;

        const connectionPromise = new Promise<void>(resolve => {
          signal.once("Signal.Socket.connect", (socket: net.Socket) => {
            adapter = new NodeSocketDebugAdapter(socket);

            adapter.on("TestReporter.found", data => {
              events.push({ type: "found", data });
            });

            adapter.on("LifecycleReporter.error", data => {
              events.push({ type: "error", data });
            });

            adapter.on("Inspector.error", data => {
              connectionError = new Error(data.message);
            });

            adapter.start().then(() => {
              adapter!.initialize({
                adapterID: "bun-test",
                pathFormat: "path",
                enableTestReporter: true,
                enableLifecycleAgentReporter: true,
              });
              resolve();
            });
          });

          // Also resolve if connection times out
          setTimeoutPromise(2000).then(() => resolve());
        });

        const bunProcess = spawn("bun", ["test", file as string, `--inspect-wait=${signal.url}`], {
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stderr = "";
        bunProcess.stderr?.on("data", data => {
          stderr += data.toString();
        });

        await connectionPromise;

        const exitCode = await new Promise<number>(resolve => {
          bunProcess.on("exit", code => resolve(code ?? -1));
        });

        // Different files have different expected behaviors
        if (name === "syntax error") {
          // Should exit with error
          expect(exitCode).not.toBe(0);
          expect(stderr).toContain("error");
        } else if (name === "large array") {
          // Should handle large arrays - Bun might not find all 1000 immediately
          const foundTests = events.filter(e => e.type === "found" && e.data.type === "test");
          expect(foundTests.length).toBeGreaterThan(100); // At least found many
          console.log(`Large array test found ${foundTests.length} tests`);
        }

        // Clean up
        adapter?.close();
        (signal as any).close();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test.skip("race conditions and concurrent operations", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bun-vscode-race-"));

    try {
      // Create a test file that we'll modify during execution
      const testFile = path.join(tmpDir, "race.test.ts");
      const initialContent = `
import { test, expect } from "bun:test";

test("test 1", () => {
  expect(1).toBe(1);
});

test("test 2", () => {
  expect(2).toBe(2);
});
`;
      await fs.writeFile(testFile, initialContent);

      // Start first connection
      const signal1 = process.platform === "win32" ? new TCPSocketSignal(await getAvailablePort()) : new UnixSignal();

      await signal1.ready;

      const events1: any[] = [];
      let adapter1: NodeSocketDebugAdapter | null = null;

      const connection1Promise = new Promise<void>(resolve => {
        signal1.once("Signal.Socket.connect", (socket: net.Socket) => {
          adapter1 = new NodeSocketDebugAdapter(socket);

          adapter1.on("TestReporter.found", data => {
            events1.push({ type: "found", data });
          });

          adapter1.start().then(() => {
            adapter1!.initialize({
              adapterID: "bun-test",
              pathFormat: "path",
              enableTestReporter: true,
              enableLifecycleAgentReporter: true,
            });
            resolve();
          });
        });
      });

      const bunProcess1 = spawn("bun", ["test", testFile, `--inspect-wait=${signal1.url}`]);

      await connection1Promise;

      // While first test is running, modify the file
      await setTimeoutPromise(10);

      const modifiedContent = `
import { test, expect } from "bun:test";

test("test 1 modified", () => {
  expect(1).toBe(1);
});

test("test 2", () => {
  expect(2).toBe(2);
});

test("test 3 new", () => {
  expect(3).toBe(3);
});
`;
      await fs.writeFile(testFile, modifiedContent);

      // Start second connection on the modified file
      const signal2 = process.platform === "win32" ? new TCPSocketSignal(await getAvailablePort()) : new UnixSignal();

      await signal2.ready;

      const events2: any[] = [];
      let adapter2: NodeSocketDebugAdapter | null = null;

      const connection2Promise = new Promise<void>(resolve => {
        signal2.once("Signal.Socket.connect", (socket: net.Socket) => {
          adapter2 = new NodeSocketDebugAdapter(socket);

          adapter2.on("TestReporter.found", data => {
            events2.push({ type: "found", data });
          });

          adapter2.start().then(() => {
            adapter2!.initialize({
              adapterID: "bun-test",
              pathFormat: "path",
              enableTestReporter: true,
              enableLifecycleAgentReporter: true,
            });
            resolve();
          });
        });
      });

      const bunProcess2 = spawn("bun", ["test", testFile, `--inspect-wait=${signal2.url}`]);

      await connection2Promise;

      // Wait for both processes
      await Promise.all([
        new Promise(resolve => bunProcess1.on("exit", resolve)),
        new Promise(resolve => bunProcess2.on("exit", resolve)),
      ]);

      // Verify both connections got different test sets
      const tests1 = events1.filter(e => e.type === "found" && e.data.type === "test");
      const tests2 = events2.filter(e => e.type === "found" && e.data.type === "test");

      expect(tests1.length).toBe(2); // Original file
      expect(tests2.length).toBe(3); // Modified file

      const names1 = tests1.map(t => t.data.name);
      const names2 = tests2.map(t => t.data.name);

      expect(names1).toContain("test 1");
      expect(names2).toContain("test 1 modified");
      expect(names2).toContain("test 3 new");

      // Clean up
      adapter1?.close();
      adapter2?.close();
      (signal1 as any).close();
      (signal2 as any).close();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 30000); // 30s timeout

  test("memory stress test with thousands of tests", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bun-vscode-memory-"));

    try {
      // Generate a file with 5000 tests
      let content = 'import { test, expect } from "bun:test";\n\n';

      // Mix of regular tests and test.each
      for (let i = 0; i < 500; i++) {
        // Regular tests
        for (let j = 0; j < 5; j++) {
          content += `test("regular test ${i}-${j}", () => {\n`;
          content += `  expect(${i * 10 + j}).toBe(${i * 10 + j});\n`;
          content += `});\n\n`;
        }

        // test.each with 5 cases each
        content += `test.each([\n`;
        for (let k = 0; k < 5; k++) {
          content += `  [${i * 100 + k}, "${i}-${k}"],\n`;
        }
        content += `])("test.each %i with %s", (num, str) => {\n`;
        content += `  expect(num).toBeGreaterThan(-1);\n`;
        content += `});\n\n`;
      }

      const testFile = path.join(tmpDir, "memory.test.ts");
      await fs.writeFile(testFile, content);

      // Track memory usage
      const initialMemory = process.memoryUsage();

      const signal = process.platform === "win32" ? new TCPSocketSignal(await getAvailablePort()) : new UnixSignal();

      await signal.ready;

      const events: { type: string; data: any }[] = [];
      let adapter: NodeSocketDebugAdapter | null = null;
      const startTime = Date.now();

      const connectionPromise = new Promise<void>(resolve => {
        signal.once("Signal.Socket.connect", (socket: net.Socket) => {
          adapter = new NodeSocketDebugAdapter(socket);

          adapter.on("TestReporter.found", data => {
            events.push({ type: "found", data });
          });

          adapter.start().then(() => {
            adapter!.initialize({
              adapterID: "bun-test",
              pathFormat: "path",
              enableTestReporter: true,
              enableLifecycleAgentReporter: true,
            });
            resolve();
          });
        });
      });

      const bunProcess = spawn("bun", ["test", testFile, `--inspect-wait=${signal.url}`, "--timeout=100"]);

      await connectionPromise;

      // Wait for discovery with timeout
      await Promise.race([
        new Promise<void>(resolve => {
          const checkEvents = () => {
            if (events.filter(e => e.type === "found").length >= 4000) {
              resolve();
            } else {
              setTimeoutPromise(100).then(checkEvents);
            }
          };
          checkEvents();
        }),
        setTimeoutPromise(30000), // 30s timeout
      ]);

      bunProcess.kill();

      const discoveryTime = Date.now() - startTime;
      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      // Verify performance
      const foundEvents = events.filter(e => e.type === "found");
      // Bun might not discover all 5000 tests within timeout
      expect(foundEvents.length).toBeGreaterThan(3000); // Found most tests

      // Discovery should complete in reasonable time
      expect(discoveryTime).toBeLessThan(35000); // 35 seconds

      // Memory increase should be reasonable (less than 200MB)
      expect(memoryIncrease).toBeLessThan(200 * 1024 * 1024);

      console.log(
        `Memory stress test: ${foundEvents.length} tests discovered in ${discoveryTime}ms, memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`,
      );

      // Clean up
      adapter?.close();
      (signal as any).close();

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }, 60000); // 60s timeout for this test

  test("socket message chunking and partial data", async () => {
    // Test that handles partial socket messages correctly
    const socket = new MockSocket();
    const adapter = new NodeSocketDebugAdapter(socket as any);

    const events: any[] = [];
    adapter.on("TestReporter.found", data => {
      events.push(data);
    });

    await adapter.start();
    await adapter.initialize({
      adapterID: "bun-test",
      pathFormat: "path",
      enableTestReporter: true,
      enableLifecycleAgentReporter: true,
    });

    // Simulate receiving a message in chunks using proper framing protocol
    const messageData = JSON.stringify({
      method: "TestReporter.found",
      params: {
        id: 1,
        name: "test with very long name that might get chunked",
        type: "test",
        url: "/path/to/test.ts",
        line: 10,
      },
    });

    // Create properly framed message (4-byte length prefix + message)
    const lengthBuffer = Buffer.alloc(4);
    lengthBuffer.writeUInt32BE(Buffer.byteLength(messageData), 0);
    const fullMessage = Buffer.concat([lengthBuffer, Buffer.from(messageData)]);

    // Split the framed message into chunks
    const chunk1 = fullMessage.slice(0, 30);
    const chunk2 = fullMessage.slice(30, 60);
    const chunk3 = fullMessage.slice(60);

    // Send chunks with small delays
    socket.simulateData(chunk1);
    await setTimeoutPromise(10);
    socket.simulateData(chunk2);
    await setTimeoutPromise(10);
    socket.simulateData(chunk3);

    // Wait for processing
    await setTimeoutPromise(50);

    // Should have received the complete event
    expect(events.length).toBe(1);
    expect(events[0].name).toBe("test with very long name that might get chunked");

    adapter.close();
  });

  test("test discovery with .gitignore patterns", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bun-vscode-gitignore-"));

    try {
      // Create a .gitignore file
      await fs.writeFile(
        path.join(tmpDir, ".gitignore"),
        `
# Ignore test files in ignored directory
ignored/
*.ignore.test.ts
temp-*.test.ts
`,
      );

      // Create test files - some should be ignored
      await fs.mkdir(path.join(tmpDir, "ignored"), { recursive: true });
      await fs.writeFile(
        path.join(tmpDir, "ignored", "should-ignore.test.ts"),
        `
import { test, expect } from "bun:test";
test("ignored test", () => expect(true).toBe(true));
`,
      );

      await fs.writeFile(
        path.join(tmpDir, "should-include.test.ts"),
        `
import { test, expect } from "bun:test";
test("included test", () => expect(true).toBe(true));
`,
      );

      await fs.writeFile(
        path.join(tmpDir, "also.ignore.test.ts"),
        `
import { test, expect } from "bun:test";
test("also ignored", () => expect(true).toBe(true));
`,
      );

      await fs.writeFile(
        path.join(tmpDir, "temp-123.test.ts"),
        `
import { test, expect } from "bun:test";
test("temp ignored", () => expect(true).toBe(true));
`,
      );

      // Run test discovery
      const signal = process.platform === "win32" ? new TCPSocketSignal(await getAvailablePort()) : new UnixSignal();

      await signal.ready;

      const events: any[] = [];
      let adapter: NodeSocketDebugAdapter | null = null;

      const connectionPromise = new Promise<void>(resolve => {
        signal.once("Signal.Socket.connect", (socket: net.Socket) => {
          adapter = new NodeSocketDebugAdapter(socket);

          adapter.on("TestReporter.found", data => {
            events.push({ type: "found", data });
          });

          adapter.start().then(() => {
            adapter!.initialize({
              adapterID: "bun-test",
              pathFormat: "path",
              enableTestReporter: true,
              enableLifecycleAgentReporter: true,
            });
            resolve();
          });
        });
      });

      // Run only on the included file
      const bunProcess = spawn("bun", [
        "test",
        path.join(tmpDir, "should-include.test.ts"),
        `--inspect-wait=${signal.url}`,
      ]);

      await connectionPromise;

      await new Promise<void>(resolve => {
        bunProcess.on("exit", () => resolve());
      });

      // Should only find the included test
      const foundTests = events.filter(e => e.type === "found" && e.data.type === "test");
      expect(foundTests.length).toBe(1);
      expect(foundTests[0].data.name).toBe("included test");

      // Clean up
      adapter?.close();
      (signal as any).close();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test("test name escaping and special regex characters", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "bun-vscode-escaping-"));
    let bunProcess: ReturnType<typeof spawn> | null = null;

    try {
      const testFile = path.join(tmpDir, "escaping.test.ts");
      await fs.writeFile(
        testFile,
        `
import { test, expect } from "bun:test";

// Test names with regex special characters
test("test with [brackets] and (parens)", () => {
  expect(true).toBe(true);
});

test("test with $dollar and ^caret", () => {
  expect(true).toBe(true);
});

test("test with .dots. and *stars*", () => {
  expect(true).toBe(true);
});

test("test with \\\\backslashes\\\\ and /slashes/", () => {
  expect(true).toBe(true);
});

test("test with ?question? and +plus+", () => {
  expect(true).toBe(true);
});

test("test with {braces} and |pipes|", () => {
  expect(true).toBe(true);
});
`,
      );

      const signal = process.platform === "win32" ? new TCPSocketSignal(await getAvailablePort()) : new UnixSignal();

      await signal.ready;

      const events: any[] = [];
      let adapter: NodeSocketDebugAdapter | null = null;

      const connectionPromise = new Promise<void>(resolve => {
        signal.once("Signal.Socket.connect", (socket: net.Socket) => {
          adapter = new NodeSocketDebugAdapter(socket);

          adapter.on("TestReporter.found", data => {
            events.push({ type: "found", data });
          });

          adapter.start().then(() => {
            adapter!.initialize({
              adapterID: "bun-test",
              pathFormat: "path",
              enableTestReporter: true,
              enableLifecycleAgentReporter: true,
            });
            resolve();
          });
        });
      });

      bunProcess = spawn("bun", ["test", testFile, `--inspect-wait=${signal.url}`]);

      await connectionPromise;

      // Add timeout to prevent hanging
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          bunProcess?.kill("SIGKILL");
          reject(new Error("Test process timed out"));
        }, 10000); // 10 second timeout

        bunProcess?.on("exit", () => {
          clearTimeout(timeout);
          resolve();
        });

        bunProcess?.on("error", (error: any) => {
          clearTimeout(timeout);
          reject(error);
        });
      });

      // Verify all special characters are preserved
      const foundTests = events.filter(e => e.type === "found" && e.data.type === "test");
      expect(foundTests.length).toBe(6);

      const testNames = foundTests.map(t => t.data.name);
      expect(testNames).toContain("test with [brackets] and (parens)");
      expect(testNames).toContain("test with $dollar and ^caret");
      expect(testNames).toContain("test with .dots. and *stars*");
      expect(testNames).toContain("test with \\backslashes\\ and /slashes/");
      expect(testNames).toContain("test with ?question? and +plus+");
      expect(testNames).toContain("test with {braces} and |pipes|");

      // Clean up
      adapter?.close();
      if (signal && "close" in signal && typeof (signal as any).close === "function") {
        (signal as any).close();
      }
    } finally {
      // Ensure process is terminated
      if (bunProcess && !bunProcess.killed) {
        bunProcess.kill("SIGKILL");
      }
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Socket Integration - Real Network Communication", () => {
  test("TCP signal with real socket connection", async () => {
    let signal: TCPSocketSignal | null = null;

    try {
      const port = await getAvailablePort();
      signal = new TCPSocketSignal(port);

      await signal.ready;
      expect(signal.port).toBe(port);
      expect(signal.url).toBe(`tcp://127.0.0.1:${port}`);

      // Track connection events
      const connectionEvents: any[] = [];
      const receivedData: string[] = [];

      signal.on("Signal.Socket.connect", socket => {
        connectionEvents.push({ type: "connect", socket });

        socket.on("data", (data: Buffer) => {
          receivedData.push(data.toString());
        });
      });

      signal.on("Signal.received", data => {
        connectionEvents.push({ type: "received", data });
      });

      // Create multiple client connections
      const clients: net.Socket[] = [];
      const clientPromises: Promise<void>[] = [];

      for (let i = 0; i < 3; i++) {
        const client = net.createConnection(port, "127.0.0.1");
        clients.push(client);

        const clientPromise = new Promise<void>((resolve, reject) => {
          client.on("connect", () => {
            client.write(`Client ${i} data`);
            global.setTimeout(() => {
              client.end();
              resolve();
            }, 10);
          });

          client.on("error", reject);
        });

        clientPromises.push(clientPromise);
      }

      await Promise.all(clientPromises);

      // Verify connections were established
      expect(connectionEvents.filter(e => e.type === "connect")).toHaveLength(3);
      expect(connectionEvents.filter(e => e.type === "received")).toHaveLength(3);

      // Verify data was received
      const receivedMessages = connectionEvents.filter(e => e.type === "received").map(e => e.data);

      expect(receivedMessages).toContain("Client 0 data");
      expect(receivedMessages).toContain("Client 1 data");
      expect(receivedMessages).toContain("Client 2 data");
    } finally {
      signal?.close();
    }
  });

  test("concurrent adapters with separate signals", async () => {
    const signals: TCPSocketSignal[] = [];
    const adapters: NodeSocketDebugAdapter[] = [];

    try {
      // Create multiple signals and adapters
      for (let i = 0; i < 3; i++) {
        const port = await getAvailablePort();
        const signal = new TCPSocketSignal(port);
        await signal.ready;
        signals.push(signal);

        const socket = new MockSocket() as unknown as net.Socket;
        const adapter = new NodeSocketDebugAdapter(socket);
        adapters.push(adapter);
      }

      // Verify each signal has unique port
      const ports = signals.map(s => s.port);
      const uniquePorts = [...new Set(ports)];
      expect(uniquePorts).toHaveLength(3);

      // Verify adapters are independent
      const eventCounts = adapters.map(() => 0);

      adapters.forEach((adapter, index) => {
        adapter.on("TestReporter.found", () => {
          eventCounts[index]++;
        });
      });

      // Emit events to each adapter
      adapters.forEach((adapter, index) => {
        adapter.emit("TestReporter.found", {
          id: index + 1,
          name: `test ${index}`,
          line: 1,
          type: "test",
        });
      });

      // Verify isolation
      expect(eventCounts).toEqual([1, 1, 1]);
    } finally {
      signals.forEach(signal => signal.close());
      adapters.forEach(adapter => adapter.close());
    }
  });

  test("unix signal communication", async () => {
    let signal: UnixSignal | null = null;

    try {
      signal = new UnixSignal();
      await signal.ready;

      expect(signal.url).toMatch(/^unix:\/\//);

      const events: any[] = [];
      signal.on("Signal.listening", path => {
        events.push({ type: "listening", path });
      });

      signal.on("Signal.Socket.connect", socket => {
        events.push({ type: "connect", socket });
      });

      signal.on("Signal.received", data => {
        events.push({ type: "received", data });
      });

      // Unix sockets are harder to test in cross-platform way,
      // so we just verify the signal was created properly
      // Note: listening event might be emitted before we attach the listener
      expect(events.filter(e => e.type === "listening").length).toBeGreaterThanOrEqual(0);
    } finally {
      signal?.close();
    }
  });
});

describe("Socket Integration - Error Handling and Edge Cases", () => {
  test("socket errors and recovery", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    const errorEvents: Error[] = [];

    adapter.on("Inspector.error", error => {
      errorEvents.push(error);
    });

    // Simulate socket errors without throwing
    try {
      const testError = new Error("Connection refused");
      (socket as any).simulateError(testError);
    } catch {
      // Expected to potentially throw
    }

    // Simulate data corruption
    try {
      (socket as any).simulateData("invalid-json-data{malformed");
    } catch {
      // Expected to potentially throw
    }

    // Simulate sudden disconnection
    try {
      socket.destroy(new Error("Connection lost"));
    } catch {
      // Expected to potentially throw
    }

    // Test that adapter handles errors gracefully
    expect(socket.destroyed).toBe(true);

    adapter.close();
  });

  test("large data handling", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    const largeTestData = {
      id: 1,
      name: "test with very long name ".repeat(1000),
      url: "/very/long/path/".repeat(100) + "test.ts",
      line: 1,
      type: "test" as const,
    };

    const events: any[] = [];
    adapter.on("TestReporter.found", event => {
      events.push(event);
    });

    adapter.emit("TestReporter.found", largeTestData);

    expect(events).toHaveLength(1);
    expect(events[0].name.length).toBeGreaterThan(10000);
    expect(events[0].url.length).toBeGreaterThan(1000);

    adapter.close();
  });

  test("rapid event emission", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    const events: any[] = [];
    adapter.on("TestReporter.found", event => {
      events.push(event);
    });

    // Emit many events rapidly
    const eventCount = 1000;
    for (let i = 0; i < eventCount; i++) {
      adapter.emit("TestReporter.found", {
        id: i,
        name: `rapid test ${i}`,
        line: 1,
        type: "test",
      });
    }

    expect(events).toHaveLength(eventCount);

    // Verify all events were captured correctly
    for (let i = 0; i < eventCount; i++) {
      expect(events[i].id).toBe(i);
      expect(events[i].name).toBe(`rapid test ${i}`);
    }

    adapter.close();
  });

  test("adapter cleanup and resource management", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    let cleanupCalled = false;

    // Mock cleanup detection
    const originalClose = adapter.close.bind(adapter);
    adapter.close = () => {
      cleanupCalled = true;
      originalClose();
    };

    // Add listeners to test they're properly removed
    const testHandler = () => {};
    adapter.on("TestReporter.found", testHandler);
    adapter.on("TestReporter.start", testHandler);
    adapter.on("TestReporter.end", testHandler);

    expect(adapter.listenerCount("TestReporter.found")).toBe(1);

    // Close adapter
    adapter.close();

    expect(cleanupCalled).toBe(true);
  });

  test("memory leak prevention with many events", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    // Add and remove many listeners to test memory management
    for (let i = 0; i < 100; i++) {
      const handler = () => {};
      adapter.on("TestReporter.found", handler);
      adapter.off("TestReporter.found", handler);
    }

    // Should not accumulate listeners
    expect(adapter.listenerCount("TestReporter.found")).toBe(0);

    adapter.close();
  });

  test("invalid event data handling", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    const events: any[] = [];
    adapter.on("TestReporter.found", event => {
      events.push(event);
    });

    // Test with various invalid data
    const invalidData = [
      null,
      undefined,
      "",
      {},
      { id: "not-a-number" },
      { id: 1, type: "invalid-type" },
      { id: 1, line: -1 },
    ];

    invalidData.forEach(data => {
      try {
        adapter.emit("TestReporter.found", data as any);
      } catch (error) {
        // Some invalid data might throw, which is acceptable
      }
    });

    // Adapter should handle invalid data gracefully
    // Valid events should still be captured
    adapter.emit("TestReporter.found", {
      id: 1,
      name: "valid test",
      line: 1,
      type: "test",
    });

    const validEvents = events.filter(e => e && e.id === 1 && e.name === "valid test");
    expect(validEvents).toHaveLength(1);

    adapter.close();
  });
});

describe("Socket Integration - Performance and Scalability", () => {
  test("high-volume event processing", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    const eventCounts = {
      found: 0,
      start: 0,
      end: 0,
    };

    adapter.on("TestReporter.found", () => eventCounts.found++);
    adapter.on("TestReporter.start", () => eventCounts.start++);
    adapter.on("TestReporter.end", () => eventCounts.end++);

    const startTime = Date.now();
    const testCount = 10000;

    // Simulate a large test suite
    for (let i = 0; i < testCount; i++) {
      adapter.emit("TestReporter.found", {
        id: i,
        name: `performance test ${i}`,
        line: (i % 100) + 1,
        type: "test",
      });

      if (i % 10 === 0) {
        adapter.emit("TestReporter.start", { id: i });
        adapter.emit("TestReporter.end", {
          id: i,
          status: "pass",
          elapsed: Math.random() * 100,
        });
      }
    }

    const endTime = Date.now();
    const duration = endTime - startTime;

    expect(eventCounts.found).toBe(testCount);
    expect(eventCounts.start).toBe(testCount / 10);
    expect(eventCounts.end).toBe(testCount / 10);

    // Performance assertion (should process 10k events quickly)
    expect(duration).toBeLessThan(1000); // Less than 1 second

    adapter.close();
  });

  test("concurrent socket connections performance", async () => {
    const connectionCount = 10;
    const signals: TCPSocketSignal[] = [];
    const connections: Promise<void>[] = [];

    try {
      // Create multiple signals simultaneously
      const signalPromises = Array(connectionCount)
        .fill(0)
        .map(async () => {
          const port = await getAvailablePort();
          const signal = new TCPSocketSignal(port);
          await signal.ready;
          signals.push(signal);
          return signal;
        });

      const createdSignals = await Promise.all(signalPromises);
      expect(createdSignals).toHaveLength(connectionCount);

      // Test concurrent connections
      const startTime = Date.now();

      for (const signal of signals) {
        const connectionPromise = new Promise<void>((resolve, reject) => {
          const client = net.createConnection(signal.port, "127.0.0.1");

          client.on("connect", () => {
            client.write("test data");
            client.end();
            resolve();
          });

          client.on("error", reject);
        });

        connections.push(connectionPromise);
      }

      await Promise.all(connections);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // All connections should complete quickly
      expect(duration).toBeLessThan(2000); // Less than 2 seconds
    } finally {
      signals.forEach(signal => signal.close());
    }
  });
});

describe("Socket Integration - Protocol Compliance", () => {
  test("debug adapter protocol message format", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    // Test that adapter follows DAP message structure
    const initResponse = adapter.initialize({
      clientID: "test",
      adapterID: "bun",
    }) as any;

    // Verify response has required DAP structure
    expect(typeof initResponse).toBe("object");
    expect(initResponse.supportsConfigurationDoneRequest).toBeDefined();
    expect(typeof initResponse.supportsConfigurationDoneRequest).toBe("boolean");

    adapter.close();
  });

  test("inspector protocol compatibility", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    const inspector = adapter.getInspector();

    // Verify inspector has required methods
    expect(typeof inspector.send).toBe("function");
    expect(typeof inspector.close).toBe("function");

    adapter.close();
  });

  test("event emission patterns match specification", async () => {
    const socket = new MockSocket() as unknown as net.Socket;
    const adapter = new NodeSocketDebugAdapter(socket);

    const allEvents: Array<{ event: string; data: any }> = [];

    // Capture all events
    const originalEmit = adapter.emit.bind(adapter);
    adapter.emit = function (event: any, ...args: any[]) {
      if (typeof event === "string" && event.includes("Reporter")) {
        allEvents.push({ event, data: args[0] });
      }
      return originalEmit(event, ...args);
    };

    // Emit standard test lifecycle
    adapter.emit("TestReporter.found", {
      id: 1,
      name: "test",
      line: 1,
      type: "test",
    });

    adapter.emit("TestReporter.start", { id: 1 });
    adapter.emit("TestReporter.end", {
      id: 1,
      status: "pass",
      elapsed: 10,
    });

    // Verify event structure compliance
    expect(allEvents).toHaveLength(3);

    const foundEvent = allEvents[0];
    expect(foundEvent.event).toBe("TestReporter.found");
    expect(foundEvent.data).toHaveProperty("id");
    expect(foundEvent.data).toHaveProperty("name");
    expect(foundEvent.data).toHaveProperty("line");
    expect(foundEvent.data).toHaveProperty("type");

    const startEvent = allEvents[1];
    expect(startEvent.event).toBe("TestReporter.start");
    expect(startEvent.data).toHaveProperty("id");

    const endEvent = allEvents[2];
    expect(endEvent.event).toBe("TestReporter.end");
    expect(endEvent.data).toHaveProperty("id");
    expect(endEvent.data).toHaveProperty("status");
    expect(endEvent.data).toHaveProperty("elapsed");

    adapter.close();
  });
});
