# Bun Hot Module Reloading (HMR) and Hot Code Swapping Research

## Overview

Bun implements hot module reloading (HMR) and hot code swapping through a sophisticated system that combines file watching, incremental bundling, WebSocket communication, and a runtime HMR module system. The implementation supports both client-side and server-side hot reloading, with special support for React Fast Refresh.

## Architecture Components

### 1. File Watching System

Bun uses platform-specific file watchers on a separate thread:

- **Linux**: INotifyWatcher using inotify system calls
- **macOS**: KEventWatcher using kqueue
- **Windows**: WindowsWatcher using IOCP and ReadDirectoryChangesW

The watcher system:

- Runs on its own thread to avoid blocking the main event loop
- Coalesces multiple file change events to reduce noise
- Communicates with the main thread using atomic operations and concurrent tasks
- Supports watching both files and directories recursively

### 2. DevServer and Incremental Bundler

The DevServer (`src/bake/DevServer.zig`) is the core component that:

- Manages the incremental bundling process
- Maintains separate dependency graphs for client and server code
- Tracks which files need rebundling when changes occur
- Handles WebSocket connections for pushing updates to clients

Key features:

- Incremental bundling: Only rebuilds changed modules and their dependents
- Dual graphs: Separate incremental graphs for client and server code
- Source map management with reference counting
- Asset serving and caching

### 3. WebSocket Protocol

The WebSocket protocol (`src/bake/DevServer.zig:MessageId`) uses binary messages with a single-byte message ID prefix:

- **Version (V)**: Sent on connection to ensure client/server compatibility
- **Hot Update (u)**: Contains updated modules, CSS changes, and route updates
- **Errors (e)**: Sends bundling/runtime errors to display in overlay
- **Memory Visualizer (M)**: Debug information about memory usage

The protocol is designed for efficiency:

- Binary transport for minimal overhead
- Batched updates to reduce round trips
- Client-side deduplication of updates

### 4. HMR Runtime

The HMR runtime consists of two main parts:

#### Client-side Runtime (`src/bake/hmr-module.ts`)

- Implements the `import.meta.hot` API compatible with Vite
- Manages module registry and dependency tracking
- Handles module replacement and state preservation
- Supports React Fast Refresh for component hot reloading

#### Server-side Runtime (`src/bake/hmr-runtime-server.ts`)

- Handles server-side module replacement
- Manages route updates without full page reloads
- Integrates with framework-specific reloading mechanisms

### 5. Module System Features

#### Module Registry

- Each module gets a unique ID and is stored in a registry
- Modules can be ESM or CommonJS
- Module state is preserved across reloads using `import.meta.hot.data`

#### HMR Boundaries

- Modules can self-accept updates with `import.meta.hot.accept()`
- Parent modules can accept updates for dependencies
- If no boundary is found, triggers a full page reload
- Automatic boundary detection for modules using `import.meta.hot.data`

#### React Fast Refresh

- Automatic integration when React is detected
- Wraps React components with refresh signatures
- Preserves component state during updates
- Uses a hash-based system to detect hook changes

## Implementation Details

### File Change Detection Flow

1. **File System Event**: Platform watcher detects file change
2. **Event Coalescing**: Multiple rapid changes are batched (100μs window)
3. **Hot Reload Event**: Created and passed to DevServer thread
4. **Dependency Analysis**: Determines which modules are affected
5. **Incremental Bundle**: Only rebuilds changed modules
6. **WebSocket Push**: Sends updates to connected clients
7. **Runtime Update**: Client applies changes without page reload

### Incremental Bundling Strategy

The incremental bundler maintains:

- **File indices**: Maps file paths to graph nodes
- **Import/export tracking**: Knows module dependencies
- **Stale file tracking**: Marks files needing rebuild
- **Edge tracking**: Import relationships between modules

When a file changes:

1. Mark the file and its importers as stale
2. Trace through the dependency graph
3. Find HMR boundaries (self-accepting modules)
4. Bundle only the stale modules
5. Generate minimal update payloads

### CSS Hot Reloading

CSS updates are handled specially:

- CSS files are tracked separately in the bundler
- Changes trigger immediate style updates without JS evaluation
- Uses a content-based hash system for deduplication
- Supports both `<link>` and `<style>` tag updates

### Error Handling and Recovery

The system includes sophisticated error handling:

- Bundling errors are captured and sent to clients
- Error overlay displays compilation errors
- Graceful fallback to full reload on critical errors
- Atomic updates ensure consistency

## Performance Optimizations

1. **Memory Recycling**: Reuses HotReloadEvent objects between updates
2. **Atomic Operations**: Lock-free communication between threads
3. **Reference Counting**: Source maps are reference counted for memory efficiency
4. **Lazy Evaluation**: Modules are only loaded when imported
5. **Binary Protocol**: Minimal overhead in WebSocket communication
6. **Incremental Bundling**: Only rebuilds what changed

## React Fast Refresh Integration

Bun automatically detects React and enables Fast Refresh:

- Identifies React components by naming convention
- Wraps components with refresh registration calls
- Hashes hook usage to detect incompatible changes
- Falls back to full reload for hook signature changes

## Framework Integration

The HMR system is designed to work with various frameworks:

- Provides `onServerSideReload` hook for framework integration
- Supports server component boundaries
- Handles route-based code splitting
- Preserves framework-specific state

## Testing and Debugging

The implementation includes extensive testing support:

- Synchronization primitives for deterministic tests
- WebSocket message inspection and batching
- Memory visualization for debugging leaks
- Incremental bundler visualization

## Limitations and Trade-offs

1. **Browser Compatibility**: Some features require modern browsers
2. **Memory Usage**: Keeping module state increases memory footprint
3. **Complex Dependencies**: Circular dependencies can cause issues
4. **State Preservation**: Not all state can be preserved automatically
5. **Framework Constraints**: Some frameworks may not fully support HMR

## Conclusion

Bun's HMR implementation is a sophisticated system that combines efficient file watching, incremental bundling, and a flexible runtime to provide fast development feedback. The architecture prioritizes performance through careful use of threads, atomic operations, and incremental updates while maintaining compatibility with existing HMR APIs like Vite's `import.meta.hot`.
