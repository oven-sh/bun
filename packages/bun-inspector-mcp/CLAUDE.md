# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

For general Bun development guidance and API reference, see: https://bun.sh/llms.txt

## Project Overview

`bun-inspector-mcp` is a Model Context Protocol (MCP) server that provides a bridge between AI models and Bun's JavaScript debugging capabilities. It allows AI tools to connect to and interact with Bun's debugger through the WebKit Inspector Protocol.

The MCP server exposes debugging functionality as tools that can be invoked by AI assistants, enabling them to:
- Debug JavaScript applications running in Bun
- Set breakpoints and step through code
- Inspect variables and evaluate expressions
- Profile memory usage and CPU performance
- Capture and analyze console output

## Quick Start

### Installation
```bash
# Clone the repository
git clone https://github.com/oven-sh/bun
cd bun/packages/bun-inspector-mcp

# Install dependencies
bun install

# Build the project
bun run build
```

### Usage Example
```bash
# Start a Bun process with debugging enabled
bun --inspect=9229 your-script.js

# In another terminal, start the MCP server
bun run index.ts

# The MCP server is now ready to accept tool invocations
```

## Development Commands

### Building and Type Checking

- **Type check**: `bun run typecheck` - Runs TypeScript type checking without emitting files using `tsgo`
- **Build**: `bun run build` - Creates a minified Node.js-compatible bundle at `./index.js`
- **Run**: `bun run index.ts` - Start the MCP server directly
- **Install deps**: `bun install` - Install all dependencies

### Development Workflow

1. Make changes to TypeScript files (`mcp.ts`, `inspector.ts`)
2. Run `bun run typecheck` to ensure type safety
3. Test changes by running `bun run index.ts`
4. Build for production with `bun run build`

### Testing with Claude Desktop

To use this MCP server with Claude Desktop:
1. Build the project: `bun run build`
2. Add to your Claude Desktop config:
   ```json
   {
     "mcpServers": {
       "bun-inspector": {
         "command": "node",
         "args": ["/path/to/bun-inspector-mcp/index.js"]
       }
     }
   }
   ```

## Architecture

### Core Components

1. **index.ts** - Entry point that starts the MCP server
   - Initializes the stdio transport
   - Starts the server and handles graceful shutdown
   
2. **mcp.ts** - MCP server implementation with tool registration
   - Defines all MCP tools using zod schemas
   - Implements tool handlers that interact with inspectors
   - Manages inspector lifecycle and state
   
3. **inspector.ts** - WebSocket-based inspector management
   - Handles WebSocket connections to Bun debugger instances
   - Manages event listeners for debugger events
   - Provides methods for sending protocol commands

### Key Design Patterns

- **Event-Driven Architecture**: The inspector listens for debugger events and console messages
- **State Management**: Maintains maps for inspectors, call frames, and console messages by URL
- **Tool-Based Interface**: Exposes debugging capabilities as MCP tools

### Available MCP Tools

The MCP server exposes 32 tools organized into categories:

#### Connection Management
1. **registerInspector** - Connect to a Bun debugger instance via WebSocket URL
   - Input: `url` (WebSocket URL like `ws://localhost:9229`)
   - Returns: Connection status and inspector URL

#### Code Execution & Inspection
2. **Runtime.evaluate** - Execute JavaScript in the runtime context
   - Input: `url`, `expression`, optional `returnByValue`
   - Returns: Evaluation result or error
   
3. **Debugger.getScriptSource** - Retrieve source code for a specific script
   - Input: `url`, `scriptId`
   - Returns: Script source code
   
4. **getConsoleMessages** - Get buffered console messages from the inspector
   - Input: `url`
   - Returns: Array of console messages with timestamps

#### Breakpoint Management
5. **Debugger.setBreakpointByUrl** - Set a breakpoint by file URL and line number
   - Input: `url`, `urlRegex`, `lineNumber`, optional `columnNumber`
   - Returns: Breakpoint ID and actual location
   
6. **Debugger.setBreakpoint** - Set a breakpoint by script ID and line number
   - Input: `url`, `scriptId`, `lineNumber`, optional `columnNumber`
   - Returns: Breakpoint ID and actual location
   
7. **Debugger.removeBreakpoint** - Remove a breakpoint by its ID
   - Input: `url`, `breakpointId`
   - Returns: Success status
   
8. **Debugger.setBreakpointsActive** - Activate or deactivate all breakpoints
   - Input: `url`, `active` (boolean)
   - Returns: Success status

#### Debugger Control Flow Tools
9. **Debugger.pause** - Pause JavaScript execution on the next statement
10. **Debugger.resume** - Resume JavaScript execution when paused
11. **Debugger.stepInto** - Step into the next function call when paused
12. **Debugger.stepOver** - Step over the current line when paused
13. **Debugger.stepOut** - Step out of the current function when paused
14. **Debugger.continueToLocation** - Continue execution to a specific location when paused
15. **Debugger.setPauseOnExceptions** - Configure the debugger to pause on exceptions (none/uncaught/all)
16. **Debugger.evaluateOnCallFrame** - Evaluate JavaScript expression in the context of a paused call frame

#### Memory Profiling Tools
17. **Heap.enable** - Enable heap profiling events including garbage collection tracking
18. **Heap.disable** - Disable heap profiling events
19. **Heap.snapshot** - Take a heap memory snapshot
20. **Heap.gc** - Trigger a full garbage collection
21. **Heap.startTracking** - Start tracking heap memory changes
22. **Heap.stopTracking** - Stop tracking heap memory changes
23. **Heap.getPreview** - Get preview of a heap object by ID
24. **Heap.getRemoteObject** - Get remote object reference for heap object
25. **getHeapSnapshots** - Get all heap snapshots that have been taken
26. **getGCEvents** - Get all garbage collection events that have occurred

#### CPU Profiling Tools
27. **ScriptProfiler.startTracking** - Start CPU profiling with optional sampling
28. **ScriptProfiler.stopTracking** - Stop CPU profiling and get results
29. **getCPUProfiles** - Get all CPU profiling data that has been collected

#### Runtime Object Inspection Tools
30. **Runtime.getProperties** - Get properties of a remote object
31. **Runtime.callFunctionOn** - Call a function on a remote object
32. **Runtime.awaitPromise** - Wait for a promise to resolve and return the result

### Protocol Integration

This package depends on `../bun-inspector-protocol/` which provides:
- WebSocket and Socket-based inspector client implementations
- Complete TypeScript types for the WebKit Inspector Protocol
- Utility functions for formatting debug objects
- Support for all protocol domains (Console, Debugger, Runtime, Heap, ScriptProfiler, etc.)

Key protocol features used:
- **Debugger domain**: Breakpoints, stepping, script source retrieval
- **Runtime domain**: JavaScript evaluation, object inspection, console API
- **Heap domain**: Memory profiling, garbage collection tracking, heap snapshots
- **ScriptProfiler domain**: CPU profiling with optional sampling

### Inspector Connection Flow

1. User registers an inspector URL through the `registerInspector` tool
2. A WebSocket connection is established to the Bun debugger
3. On successful connection, the debugger is automatically enabled via `Debugger.enable`
4. Event listeners are set up for:
   - `Inspector.connected/error` - Connection status
   - `Debugger.paused` - Breakpoint hits with call frames
   - `Runtime.consoleAPICalled` - Console messages
   - `Heap.garbageCollected` - Garbage collection events
   - `Heap.trackingStart/trackingComplete` - Heap memory tracking events
   - `ScriptProfiler.trackingStart/trackingComplete` - CPU profiling events
5. Tools can then interact with the connected debugger

### State Storage

The inspector maintains several key maps:
- `inspectors: Map<string, BunInspector>` - Active inspector instances
- `callFrames: Map<string, JSC.Debugger.CallFrame[]>` - Current call stack per URL
- `consoleMessages: Map<string, ConsoleMessage[]>` - Buffered console output per URL
- `heapSnapshotsMap: Map<string, HeapSnapshot[]>` - Heap memory snapshots per URL
- `gcEventsMap: Map<string, GarbageCollection[]>` - Garbage collection events per URL
- `cpuProfilesMap: Map<string, CPUProfile[]>` - CPU profiling data per URL

## Working with the Codebase

### Adding New Tools

To add a new debugging tool:
1. Define the tool in `mcp.ts` using the MCP SDK's `server.registerTool()` method (not `server.tool()`)
2. Implement the handler that interacts with the inspector instance
3. Use appropriate protocol methods from the WebKit Inspector Protocol
4. Handle errors gracefully and return structured responses
5. Use type assertions for zod-parsed inputs when TypeScript inference fails

### Type Safety

- All inspector protocol interactions are fully typed through `bun-inspector-protocol`
- Use `zod` schemas for tool input validation
- TypeScript strict mode is enabled - maintain type safety
- Example of handling zod-parsed inputs:
  ```typescript
  const input = parsedInput as { url: string; expression: string };
  ```

### Error Handling

- Always wrap inspector operations in try-catch blocks
- Return descriptive error messages for debugging
- Handle WebSocket disconnections gracefully
- Example error handling pattern:
  ```typescript
  try {
    const result = await inspector.sendCommand("Runtime.evaluate", params);
    return { success: true, result };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unknown error" };
  }
  ```

## Important Notes

- This is a prototype/early-stage project (v0.0.0)
- The MCP server uses stdio transport for communication
- Console messages are buffered in memory - consider limits for production use
- The inspector connection is stateful - ensure proper cleanup on disconnection
- When registering MCP tools, always use `server.registerTool()` method instead of `server.tool()` for compatibility
- Type assertions may be needed when working with zod-parsed inputs in tool handlers
- The debugger is automatically enabled when connecting to an inspector
- Heap snapshots can be large - be mindful of memory usage when storing multiple snapshots
- Memory profiling requires explicit enablement via `Heap.enable` before events will be captured
- CPU profiling with sampling provides stack traces but may impact performance

## Common Use Cases

### Debugging a Script
1. Start Bun with debugging: `bun --inspect=9229 script.js`
2. Register the inspector: `registerInspector` with `ws://localhost:9229`
3. Set breakpoints: `Debugger.setBreakpointByUrl` with file path and line number
4. When paused, inspect variables: `Debugger.evaluateOnCallFrame`
5. Step through code: `Debugger.stepOver`, `Debugger.stepInto`, etc.

### Memory Profiling
1. Enable heap profiling: `Heap.enable`
2. Take initial snapshot: `Heap.snapshot`
3. Run operations to profile
4. Take another snapshot: `Heap.snapshot`
5. Compare snapshots: `getHeapSnapshots` to analyze memory growth

### Performance Analysis
1. Start CPU profiling: `ScriptProfiler.startTracking` with sampling enabled
2. Run the code to profile
3. Stop profiling: `ScriptProfiler.stopTracking`
4. Analyze results: `getCPUProfiles` to identify bottlenecks

## Troubleshooting

### Connection Issues
- Ensure Bun is started with `--inspect` or `--inspect-brk` flag
- Check the WebSocket URL format: `ws://localhost:PORT`
- Verify no firewall is blocking the debugger port

### Missing Events
- For heap events, ensure `Heap.enable` is called first
- Console messages are only captured after inspector connection
- Breakpoints require exact file paths or regex patterns

### Performance Considerations
- Limit the number of heap snapshots (they can be large)
- CPU profiling with sampling may impact application performance
- Consider using `returnByValue: false` for large objects in evaluations