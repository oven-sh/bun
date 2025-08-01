# bun-inspector-protocol

`bun-inspector-protocol` is a TypeScript library that provides a comprehensive interface for interacting with the WebKit Inspector Protocol. This package makes it easy to build debugging tools, IDE integrations, and other developer tools that communicate with Bun's JavaScript runtime.

You can use this library with Node.js or Bun.

## Overview

The WebKit Inspector Protocol is a JSON-based protocol similar to the Chrome DevTools Protocol. It allows external tools to interact with Bun's JavaScript runtime for debugging, profiling, and instrumentation purposes.

## Features

- 🌐 **WebSocket communication**: Connect to Bun's debugging endpoint via WebSockets
- 🔌 **Socket communication**: Connect via Unix/TCP sockets for local debugging
- 🔄 **Full API typing**: Complete TypeScript definitions for the protocol
- 📊 **Object preview utilities**: Format runtime objects for display
- 🔄 **Event-driven architecture**: Subscribe to specific debugging events
- 🧩 **Promise-based API**: Clean, modern async interface

## Installation

```bash
bun add bun-inspector-protocol
# npm install bun-inspector-protocol
# yarn add bun-inspector-protocol
# pnpm add bun-inspector-protocol
```

## Basic Usage

The first step is to spawn a Bun process with the inspector attached. There are a few different ways to do this.

The `--inspect-wait` flag is the easiest way to spawn a Bun process with the inspector attached.

```bash
bun --inspect-wait my-script.ts
```

From there, it will start a WebSocket server defaulting to port 9229 and you will need to read the output from stdout to get the URL of the inspector:

```bash
bun --inspect-wait my-script.ts 2>&1 | grep -o '\sws://.*$'
```

From there, you can connect to the inspector using the `WebSocketInspector` class:

```typescript
import { WebSocketInspector } from "bun-inspector-protocol";

// Create a new inspector client
const inspector = new WebSocketInspector("ws://localhost:9229/ws");
```

### Connecting via WebSocket

```typescript
import { WebSocketInspector } from "bun-inspector-protocol";

// Create a new inspector client
const inspector = new WebSocketInspector("ws://localhost:9229/ws");

// Listen for connection events
inspector.on("Inspector.connected", () => {
  console.log("Connected to debugger!");
});

inspector.on("Inspector.error", error => {
  console.error("Inspector error:", error);
});

// Connect to the debugger
await inspector.start();

// Enable the Runtime domain
await inspector.send("Runtime.enable");

// Execute some code in the target context
const result = await inspector.send("Runtime.evaluate", {
  expression: "2 + 2",
  returnByValue: true,
});

console.log("Evaluation result:", result.result.value); // 4

// Close the connection
inspector.close();
```

### Connecting via Socket (for Local Debugging)

```typescript
import { NodeSocketInspector } from "bun-inspector-protocol";
import { Socket } from "node:net";

// Create a socket connection
const socket = new Socket();
socket.connect("/path/to/debug/socket");

// Create a new inspector client
const inspector = new NodeSocketInspector(socket);

// Set up event listeners and use the API as with WebSocketInspector
inspector.on("Inspector.connected", () => {
  console.log("Connected to debugger via socket!");
});

await inspector.start();
// Use the same API as WebSocketInspector from here...
```

## Event Handling

The inspector emits various events you can listen for:

```typescript
// Listen for specific protocol events
inspector.on("Debugger.scriptParsed", params => {
  console.log("Script parsed:", params.url);
});

// Listen for breakpoint hits
inspector.on("Debugger.paused", params => {
  console.log("Execution paused at:", params.callFrames[0].location);
});

// Listen for console messages
inspector.on("Runtime.consoleAPICalled", params => {
  console.log(
    "Console message:",
    params.args
      .map(arg =>
        // Use the included utility to format objects
        remoteObjectToString(arg, true),
      )
      .join(" "),
  );
});
```

## Protocol Domains

The WebKit Inspector Protocol is organized into domains that group related functionality. Based on the JavaScriptCore protocol implementation, the following domains are available:

### Console Domain

- Console message capturing and monitoring
- Support for different logging channels and levels (xml, javascript, network, etc.)
- Methods: `enable`, `disable`, `clearMessages`, `setLoggingChannelLevel`, etc.
- Events: `messageAdded`, `messageRepeatCountUpdated`, `messagesCleared`

### Debugger Domain

- Comprehensive debugging capabilities
- Setting and managing breakpoints (conditional, URL-based, symbolic)
- Execution control (pause, resume, step, etc.)
- Stack frame inspection and manipulation
- Methods: `enable`, `setBreakpoint`, `resume`, `stepInto`, `evaluateOnCallFrame`, etc.
- Events: `scriptParsed`, `breakpointResolved`, `paused`, `resumed`

### Heap Domain

- Memory management and garbage collection monitoring
- Heap snapshot creation and analysis
- Memory leak detection with tracking
- Methods: `enable`, `gc`, `snapshot`, `startTracking`, `stopTracking`
- Events: `garbageCollected`, `trackingStart`, `trackingComplete`

### Inspector Domain

- Core inspector functionality
- Methods: `enable`, `disable`, `initialized`
- Events: `evaluateForTestInFrontend`, `inspect`

### LifecycleReporter Domain

- Process lifecycle management
- Error reporting
- Methods: `enable`, `preventExit`, `stopPreventingExit`
- Events: `reload`, `error`

### Runtime Domain

- JavaScript runtime interaction
- Expression evaluation
- Object property inspection
- Promise handling
- Type profiling and control flow analysis
- Methods: `evaluate`, `callFunctionOn`, `getProperties`, `awaitPromise`, etc.
- Events: `executionContextCreated`

### ScriptProfiler Domain

- Script execution profiling
- Performance tracking
- Methods: `startTracking`, `stopTracking`
- Events: `trackingStart`, `trackingUpdate`, `trackingComplete`

### TestReporter Domain

- Test execution monitoring
- Test status reporting (pass, fail, timeout, skip, todo)
- Methods: `enable`, `disable`
- Events: `found`, `start`, `end`

Each domain has its own set of commands, events, and data types. Refer to the TypeScript definitions in this package for complete API details.

## Working with Remote Objects

When evaluating expressions, you'll often receive remote object references. Use the `remoteObjectToString` utility to convert these to string representations:

```typescript
import { remoteObjectToString } from "bun-inspector-protocol";

const result = await inspector.send("Runtime.evaluate", {
  expression: "{ a: 1, b: { c: 'hello' } }",
});

console.log(remoteObjectToString(result.result, true));
// Output: {a: 1, b: {c: "hello"}}
```

## Message Structure

The protocol uses a simple JSON-based message format:

### Requests

```typescript
interface Request<T> {
  id: number; // Unique request identifier
  method: string; // Domain.method name format
  params: T; // Method-specific parameters
}
```

### Responses

```typescript
interface Response<T> {
  id: number; // Matching request identifier
  result?: T; // Method-specific result (on success)
  error?: {
    // Error information (on failure)
    code?: string;
    message: string;
  };
}
```

### Events

```typescript
interface Event<T> {
  method: string; // Domain.event name format
  params: T; // Event-specific parameters
}
```

### Setting Breakpoints

```typescript
// Set a breakpoint by URL
const { breakpointId } = await inspector.send("Debugger.setBreakpointByUrl", {
  lineNumber: 42,
  url: "/app/foo.ts",
  condition: "x > 5", // Optional condition
});

// Set a breakpoint with custom actions
await inspector.send("Debugger.setBreakpoint", {
  location: { scriptId: "123", lineNumber: 10 },
  options: {
    condition: "count > 5",
    actions: [
      { type: "log", data: "Breakpoint hit!" },
      { type: "evaluate", data: "console.log('Custom breakpoint action')" },
    ],
    autoContinue: true,
  },
});

// Remove a breakpoint
await inspector.send("Debugger.removeBreakpoint", { breakpointId });
```

### Memory Profiling

```typescript
// Start heap tracking
await inspector.send("Heap.enable");
await inspector.send("Heap.startTracking");

// Listen for GC events
inspector.on("Heap.garbageCollected", ({ collection }) => {
  console.log(
    `GC completed: ${collection.type} (${collection.endTime - collection.startTime}ms)`,
  );
});

// ... perform operations to analyze ...

// Get heap snapshot
const { snapshotData } = await inspector.send("Heap.stopTracking");
// Process snapshotData to find memory leaks
```

### Script Profiling

```typescript
// Start script profiling with sampling
await inspector.send("ScriptProfiler.startTracking", { includeSamples: true });

// Listen for profiling updates
inspector.on("ScriptProfiler.trackingUpdate", event => {
  console.log("Profiling event:", event);
});

// Stop profiling to get complete data
inspector.on("ScriptProfiler.trackingComplete", data => {
  if (data.samples) {
    // Process stack traces
    console.log(`Collected ${data.samples.stackTraces.length} stack traces`);
  }
});

await inspector.send("ScriptProfiler.stopTracking");
```

## Protocol Differences from Upstream WebKit

Notable Bun-specific additions include:

- `LifecycleReporter` domain for process lifecycle management
- Enhanced `TestReporter` domain for test framework integration
- Additional utilities for script and heap profiling

## Building Tools with the Protocol

This library is ideal for building:

- IDE extensions and debuggers
- Performance monitoring tools
- Testing frameworks with runtime instrumentation
- Hot module reloading systems
- Custom REPL environments
- Profiling and optimization tools

## Full API Reference

For complete API documentation, please refer to the TypeScript definitions included in this package. The definitions provide comprehensive information about all available commands, events, and their parameters.

## License

MIT
