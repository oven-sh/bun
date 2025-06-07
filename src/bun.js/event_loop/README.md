# Bun Event Loop Architecture

A comprehensive guide to Bun's sophisticated event loop system that powers both JavaScript execution and non-JavaScript tooling operations.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Components](#core-components)
- [Event Loop Variants](#event-loop-variants)
- [Task System Deep Dive](#task-system-deep-dive)
- [Concurrency Model](#concurrency-model)
- [Platform Integration](#platform-integration)
- [System Integrations](#system-integrations)
- [Performance Architecture](#performance-architecture)
- [Memory Management](#memory-management)
- [Development Guide](#development-guide)

## Architecture Overview

Bun's event loop is built on a multi-layered architecture that provides both high-performance JavaScript execution and efficient tooling operations:

```
┌─────────────────────────────────────────────────────────────┐
│                    JavaScript Layer                         │
│  ┌─────────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │   Microtasks    │  │  Timers &    │  │   Immediate     │ │
│  │   (Promises)    │  │  Intervals   │  │   Tasks         │ │
│  └─────────────────┘  └──────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                   Event Loop Core                           │
│  ┌─────────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │   Task Queue    │  │  Concurrent  │  │   Deferred      │ │
│  │  (90+ types)    │  │  Task Queue  │  │   Task Queue    │ │
│  └─────────────────┘  └──────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│                   Platform Layer                            │
│  ┌─────────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │   uSockets      │  │   Work Pool  │  │   OS Signals    │ │
│  │   (Network)     │  │  (Threads)   │  │  (POSIX only)   │ │
│  └─────────────────┘  └──────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### EventLoop (`event_loop.zig`)

The primary event loop for JavaScript contexts, orchestrating the execution of all asynchronous operations:

**Key Responsibilities:**

- **Task Orchestration**: Manages 90+ different task types through a tagged pointer union
- **JavaScript Integration**: Coordinates with JavaScriptCore for microtask drainage and promise handling
- **I/O Coordination**: Interfaces with uSockets for network operations and filesystem events
- **Memory Management**: Works with garbage collection controller for optimal memory usage
- **Cross-thread Communication**: Safely handles tasks from background threads

**Critical Fields:**

```zig
pub const EventLoop = struct {
    tasks: Queue,                                    // Main execution queue
    immediate_tasks: ArrayListUnmanaged,             // setImmediate() current tick
    immediate_cpp_tasks: ArrayListUnmanaged,         // C++ immediate tasks current tick
    next_immediate_tasks: ArrayListUnmanaged,        // setImmediate() next tick
    next_immediate_cpp_tasks: ArrayListUnmanaged,    // C++ immediate tasks next tick
    concurrent_tasks: ConcurrentTask.Queue,          // Thread-safe cross-thread queue
    global: *JSC.JSGlobalObject,                    // JavaScript global context
    virtual_machine: *VirtualMachine,               // VM reference
    gc_controller: GarbageCollectionController,     // Memory management
    signal_handler: ?*PosixSignalHandle,            // Unix signal handling
    is_inside_spawn_sync: bool,                      // Prevents microtask drainage during spawnSync
    darwin_select_fd_map: ?*DarwinSelectFallbackThread.Map, // macOS file polling
    // ... other fields
};
```

### MiniEventLoop (`MiniEventLoop.zig`)

A lightweight event loop for non-JavaScript contexts that enables code reuse across Bun's tooling:

**Use Cases:**

- **Build Operations** (`bun build`): Asset processing with async I/O
- **Package Management** (`bun install`): Concurrent network requests and dependency resolution
- **Shell Execution**: Command processing with proper I/O handling
- **Standalone Tools**: Any subsystem requiring event-driven architecture without JavaScript overhead

**Architecture Benefits:**

- Same uSockets foundation as JSC EventLoop
- Concurrent task execution capability
- File polling for filesystem watching
- Environment variable management
- Stream handling (stdout/stderr) without JavaScript bindings

## Event Loop Variants

### Unified Interface Pattern

Bun provides multiple abstractions to work with different event loop types:

```zig
// Union type for compile-time polymorphism
pub const AnyEventLoop = union(EventLoopKind) {
    js: *EventLoop,
    mini: MiniEventLoop,
};

// Non-owning reference for shared operations
pub const EventLoopHandle = union(EventLoopKind) {
    js: *JSC.EventLoop,
    mini: *MiniEventLoop,
};
```

This design enables:

- **Code Reuse**: Same algorithms work across JavaScript and non-JavaScript contexts
- **Type Safety**: Compile-time guarantees about event loop capabilities
- **Performance**: Zero-cost abstraction through tagged unions

## Task System Deep Dive

### Task Type Architecture

The task system uses a tagged pointer union for zero-overhead polymorphism:

```zig
pub const Task = TaggedPointerUnion(.{
    // Filesystem Operations
    Access, AppendFile, Chmod, Chown, Close, CopyFile, Read, Write,
    Mkdir, Readdir, Stat, Lstat, Fstat, Truncate, Unlink,

    // Network Operations
    FetchTasklet, S3HttpSimpleTask, S3HttpDownloadStreamingTask,

    // Process Management
    ProcessWaiterThreadTask, ShellAsync, ShellAsyncSubprocessDone,

    // Compression/Decompression
    NativeZlib, NativeBrotli,

    // JavaScript Integration
    JSCDeferredWorkTask, ThreadSafeFunction, HotReloadTask,

    // Shell Builtins
    ShellGlobTask, ShellRmTask, ShellLsTask, ShellMkdirTask,
    ShellTouchTask, ShellCpTask, ShellMvBatchedTask,

    // Build System
    AsyncGlobWalkTask, AsyncTransformTask, RuntimeTranspilerStore,

    // Generic Task Types
    AnyTask, ManagedTask, CppTask, PosixSignalTask,

    // ... 90+ total task types
});
```

### Task Execution Flow

Tasks are processed in `tickQueueWithCount()` with sophisticated dispatch logic:

```zig
pub fn tickQueueWithCount(this: *EventLoop, virtual_machine: *VirtualMachine) u32 {
    var counter: usize = 0;

    // Debug validation - ensures proper microtask drainage
    if (comptime Environment.isDebug) {
        validateMicrotaskDrainage(this);
    }

    while (this.tasks.readItem()) |task| {
        defer counter += 1;

        // High-performance dispatch via switch on tag
        switch (task.tag()) {
            @field(Task.Tag, @typeName(FetchTasklet)) => {
                var fetch_task: *FetchTasklet = task.get(FetchTasklet).?;
                fetch_task.onProgressUpdate();
            },
            @field(Task.Tag, @typeName(ReadFile)) => {
                var fs_task: *ReadFile = task.get(ReadFile).?;
                fs_task.runFromJSThread();
            },
            // ... 90+ case statements for optimal performance
        }

        // Drain microtasks after each task to prevent memory buildup
        this.drainMicrotasksWithGlobal(global, global_vm);
    }

    return @as(u32, @truncate(counter));
}
```

## Concurrency Model

### Thread Safety Architecture

Bun's event loop implements a sophisticated concurrency model:

**Single-Threaded Core:**

- Main event loop runs on a single thread (JavaScript main thread)
- All JavaScript execution and DOM-like operations are single-threaded
- Eliminates need for locking in core execution paths

**Multi-Threaded Work Distribution:**

```zig
pub const ConcurrentTask = struct {
    task: Task,
    next: ?*ConcurrentTask,
    auto_delete: bool,  // Automatic memory management
};

// Lock-free queue for cross-thread communication
pub const Queue = UnboundedQueue(ConcurrentTask, .next);
```

**Thread Communication Patterns:**

1. **Producer-Consumer**: Background threads produce `ConcurrentTask`s, main thread consumes
2. **Atomic Reference Counting**: Safe ref/unref operations for keep-alive semantics
3. **Lock-Free Queues**: High-performance cross-thread communication without blocking

### Work Pool Integration

CPU-intensive operations leverage thread pools through specialized task types:

**WorkTask**: Generic thread pool execution with flexible result handling

```zig
pub fn WorkTask(comptime Context: type) type {
    return struct {
        // Executes Context.run() on thread pool
        // Calls Context.then() on main thread
        // Includes async debugging support
        // Manual result handling (no automatic Promise resolution)
    };
}
```

**ConcurrentPromiseTask**: Promise-based thread pool execution

```zig
pub fn ConcurrentPromiseTask(comptime Context: type) type {
    return struct {
        // Executes Context.run() on thread pool
        // Automatically resolves JavaScript Promise with result
        // Manages Promise lifecycle and error propagation
    };
}
```

## Platform Integration

### Cross-Platform I/O Strategy

**POSIX Systems (Linux/macOS):**

- Direct uSockets integration for network operations
- Native file descriptor polling for filesystem events
- Custom timer wheel implementation for high-resolution timers
- POSIX signal handling via lock-free ring buffers

**Windows:**

- libuv integration for filesystem operations
- Separate uWS loop instance for network operations
- Different handle management strategy due to Windows I/O model

**macOS-Specific Optimizations:**

- Darwin select fallback for file descriptor limitations
- kqueue integration where available
- Special handling for filesystem watching edge cases

### Signal Handling Architecture (POSIX)

Implements async-signal-safe communication between signal handlers and main thread:

```zig
pub const PosixSignalHandle = struct {
    signals: [8192]u8,  // Ring buffer for signal numbers
    tail: std.atomic.Value(u16),    // Producer index (signal handler)
    head: std.atomic.Value(u16),    // Consumer index (main thread)

    // Called from signal handler - must be async-signal-safe
    pub fn enqueue(this: *PosixSignalHandle, signal: u8) bool {
        // Atomic ring buffer operations only
        // Wakes up event loop if successful
    }

    // Called from main thread - safe to allocate/call functions
    pub fn drain(this: *PosixSignalHandle, event_loop: *EventLoop) void {
        // Converts signals to PosixSignalTask instances
        // Enqueues tasks in main event loop
    }
};
```

## System Integrations

### HTTP Server Integration

**WebSocket Management:**

```zig
// WebSocket events execute within event loop context
const loop = vm.eventLoop();
loop.enter();
defer loop.exit();
// ... handle WebSocket event
```

**Request/Response Lifecycle:**

- HTTP requests processed through uSockets integration
- Response streaming managed via deferred task queue
- Keep-alive connections tracked through event loop refs

### Filesystem Operations

**Async FS Task Pattern:**

```zig
// Example: Async file read operation
const ReadFileTask = struct {
    pub fn runFromJSThread(this: *ReadFileTask) void {
        // Process file read result on main thread
        // Resolve JavaScript Promise or call callback
        this.deinit(); // Clean up resources
    }
};
```

**File Watching Integration:**

- FSWatcher events queued as concurrent tasks
- Filesystem changes trigger task execution on main thread
- Cross-platform file watching through platform-specific mechanisms

### JavaScript Engine Coordination

**Microtask Management:**

```zig
pub fn drainMicrotasksWithGlobal(this: *EventLoop, globalObject: *JSGlobalObject, jsc_vm: *JSC.VM) void {
    jsc_vm.releaseWeakRefs();                    // Clean up weak references
    JSC__JSGlobalObject__drainMicrotasks(globalObject);  // Drain Promise.then(), etc.

    this.virtual_machine.is_inside_deferred_task_queue = true;
    this.deferred_tasks.run();                   // Process deferred I/O operations
    this.virtual_machine.is_inside_deferred_task_queue = false;
}
```

**JSC Integration Bridge:**

```zig
export fn Bun__queueJSCDeferredWorkTaskConcurrently(jsc_vm: *VirtualMachine, task: *JSCDeferredWorkTask) void {
    var loop = jsc_vm.eventLoop();
    loop.enqueueTaskConcurrent(ConcurrentTask.new(.{
        .task = Task.init(task),
        .auto_delete = true,
    }));
}
```

### Process Management

**Subprocess Integration:**

```zig
// Subprocess tracking with event loop timers
const Subprocess = struct {
    event_loop_timer_refd: bool = false,
    event_loop_timer: Timer.EventLoopTimer = .{
        .tag = .SubprocessTimeout,
    },

    // Process events handled through concurrent task queuing
};
```

## Performance Architecture

### Optimization Strategies

**Zero-Cost Abstractions:**

- Tagged pointer unions eliminate virtual dispatch overhead
- Compile-time polymorphism through generic types
- Inlined function calls for critical paths

**Memory Layout Optimizations:**

- Linear FIFO queues for cache-friendly access patterns
- Batch processing to amortize syscall costs
- Pre-allocated buffers for common operations

**Lock-Free Data Structures:**

- Unbounded queues for cross-thread communication
- Atomic reference counting for lifecycle management
- Ring buffers for signal handling

### Benchmarking and Profiling Support

**Debug Infrastructure:**

```zig
pub const Debug = if (Environment.isDebug) struct {
    is_inside_tick_queue: bool = false,
    js_call_count_outside_tick_queue: usize = 0,
    drain_microtasks_count_outside_tick_queue: usize = 0,
    track_last_fn_name: bool = false,

    // Validates proper microtask drainage patterns
    // Prevents memory leaks from undrained promises
    // Tracks JavaScript function call patterns
} else struct {};
```

**Performance Monitoring:**

- Task execution counters
- Event loop iteration tracking
- Memory allocation monitoring through GC integration

## Memory Management

### Garbage Collection Integration

**Adaptive GC Scheduling:**

```zig
pub const GarbageCollectionController = struct {
    gc_timer_state: GCTimerState,
    gc_last_heap_size: usize,
    heap_size_didnt_change_for_repeating_timer_ticks_count: u8,

    // Fast mode: GC every 1 second when heap growing
    // Slow mode: GC every 30 seconds when heap stable
    // Immediate GC when heap doubles
};
```

**Memory Pressure Response:**

- Monitors JavaScriptCore heap size changes
- Triggers collection when memory usage doubles
- Adapts collection frequency based on allocation patterns
- Coordinates with system memory pressure notifications (but not very well yet)

### Task Memory Management

**Automatic Cleanup Patterns:**

```zig
// Tasks can specify automatic cleanup
const task = ConcurrentTask.new(.{
    .task = Task.init(work),
    .auto_delete = true,  // Automatically freed after execution
});

// Or manual lifecycle management for complex scenarios
const managed_task = ManagedTask.New(Context, callback).init(ctx);
// Automatically freed in run() method
```

**Resource Lifecycle:**

- Explicit cleanup hooks for complex resources
- Reference counting for shared resources

### Deferred Task Queue Architecture

Optimizes I/O operations by intelligently batching work:

```zig
pub const DeferredTaskQueue = struct {
    map: std.AutoArrayHashMapUnmanaged(?*anyopaque, DeferredRepeatingTask),

    // Batches I/O operations to balance latency vs. throughput
    // Prevents duplicate work scheduling
    // Runs after microtasks but before next event loop iteration
};
```

**Use Cases:**

- Redis pipelining
- File I/O operations (group multiple writes)

## Development Guide

### Adding New Task Types

1. **Define Task Structure:**

```zig
const MyTask = struct {
    // Task-specific data fields
    context: *MyContext,
    callback: *const fn(*MyContext) void,

    pub fn runFromJSThread(this: *MyTask) void {
        // Execute task on main JavaScript thread
        this.callback(this.context);
        this.deinit(); // Clean up if needed
    }

    pub fn deinit(this: *MyTask) void {
        // Resource cleanup
    }
};
```

2. **Add to Task Union:**

```zig
pub const Task = TaggedPointerUnion(.{
    // ... existing types
    MyTask,
});
```

3. **Add Dispatch Case:**

```zig
// In tickQueueWithCount()
@field(Task.Tag, @typeName(MyTask)) => {
    var my_task: *MyTask = task.get(MyTask).?;
    my_task.runFromJSThread();
},
```

### Creating Concurrent Tasks

**For CPU-Intensive Work:**

```zig
// Use WorkTask for flexible result handling
const MyWorkTask = WorkTask(struct {
    pub fn run(ctx: *@This(), work_task: *WorkTask(@This())) void {
        // Runs on thread pool
        // Perform CPU-intensive work here
        work_task.onFinish(); // Signal completion
    }

    pub fn then(ctx: *@This(), globalThis: *JSGlobalObject) void {
        // Runs on main thread
        // Handle results, call callbacks, etc.
    }
});

// Use ConcurrentPromiseTask for Promise-based APIs
const MyPromiseTask = ConcurrentPromiseTask(struct {
    pub fn run(ctx: *@This()) void {
        // Runs on thread pool
        // Set results in context
    }

    pub fn then(ctx: *@This(), promise: JSPromise) void {
        // Runs on main thread
        // Resolve or reject the promise based on results
    }
});
```

### Best Practices

**Event Loop Guidelines:**

1. **Always Drain Microtasks**: Use `runCallback()` for JavaScript calls from outside event loop
2. **Minimize Lock Contention**: Use lock-free data structures where possible
3. **Batch Operations**: Group related work to amortize syscall overhead
4. **Handle Errors Gracefully**: Ensure proper cleanup even in error paths
5. **Respect Thread Boundaries**: Never access JavaScript objects from background threads

**Memory Management:**

1. **Avoid Circular References**: Especially with JavaScript objects
2. **Monitor GC Pressure**: Be aware of allocation patterns in hot paths
3. **Clean Up Promptly**: Don't hold resources longer than necessary

**Performance Considerations:**

1. **Profile Before Optimizing**: Use built-in debugging tools
2. **Minimize Allocations**: Reuse buffers and objects where possible
3. **Batch Cross-Thread Communication**: Reduce synchronization overhead
4. **Consider Platform Differences**: Windows vs. POSIX have different optimal patterns

---

This event loop architecture enables Bun to deliver exceptional performance for both JavaScript execution and tooling operations while maintaining clean abstractions and reliable resource management.
