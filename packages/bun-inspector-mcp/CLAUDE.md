# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`bun-inspector-mcp` is a Model Context Protocol (MCP) server that provides a bridge between AI models and Bun's JavaScript debugging capabilities. It allows AI tools to connect to and interact with Bun's debugger through the WebKit Inspector Protocol.

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

## Architecture

### Core Components

1. **index.ts** - Entry point that starts the MCP server
2. **mcp.ts** - MCP server implementation with tool registration
3. **inspector.ts** - WebSocket-based inspector management

### Key Design Patterns

- **Event-Driven Architecture**: The inspector listens for debugger events and console messages
- **State Management**: Maintains maps for inspectors, call frames, and console messages by URL
- **Tool-Based Interface**: Exposes debugging capabilities as MCP tools

### Available MCP Tools

1. **registerInspector** - Connect to a Bun debugger instance via WebSocket URL
2. **Runtime.evaluate** - Execute JavaScript in the runtime context
3. **Debugger.getScriptSource** - Retrieve source code for a specific script
4. **getConsoleMessages** - Get buffered console messages from the inspector

### Protocol Integration

This package depends on `../bun-inspector-protocol/` which provides:
- WebSocket and Socket-based inspector client implementations
- Complete TypeScript types for the WebKit Inspector Protocol
- Utility functions for formatting debug objects
- Support for all protocol domains (Console, Debugger, Runtime, etc.)

### Inspector Connection Flow

1. User registers an inspector URL through the `registerInspector` tool
2. A WebSocket connection is established to the Bun debugger
3. Event listeners are set up for:
   - `Inspector.connected/error` - Connection status
   - `Debugger.paused` - Breakpoint hits with call frames
   - `Runtime.consoleAPICalled` - Console messages
4. Tools can then interact with the connected debugger

### State Storage

The inspector maintains three key maps:
- `inspectors: Map<string, BunInspector>` - Active inspector instances
- `callFrames: Map<string, JSC.Debugger.CallFrame[]>` - Current call stack per URL
- `consoleMessages: Map<string, ConsoleMessage[]>` - Buffered console output per URL

## Working with the Codebase

### Adding New Tools

To add a new debugging tool:
1. Define the tool in `mcp.ts` using the MCP SDK's `server.tool()` method
2. Implement the handler that interacts with the inspector instance
3. Use appropriate protocol methods from the WebKit Inspector Protocol
4. Handle errors gracefully and return structured responses

### Type Safety

- All inspector protocol interactions are fully typed through `bun-inspector-protocol`
- Use `zod` schemas for tool input validation
- TypeScript strict mode is enabled - maintain type safety

### Error Handling

- Always wrap inspector operations in try-catch blocks
- Return descriptive error messages for debugging
- Handle WebSocket disconnections gracefully

## Important Notes

- This is a prototype/early-stage project (v0.0.0)
- The MCP server uses stdio transport for communication
- Console messages are buffered in memory - consider limits for production use
- The inspector connection is stateful - ensure proper cleanup on disconnection