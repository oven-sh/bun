# Bun Event Loop Architecture

This document explains how Bun's event loop works, including task draining, microtasks, process.nextTick, setTimeout ordering, and I/O polling integration.

## Overview

Bun's event loop is built on top of **uSockets** (a cross-platform event loop based on epoll/kqueue) and integrates with **JavaScriptCore's** microtask queue and a custom **process.nextTick** queue. The event loop processes tasks in a specific order to ensure correct JavaScript semantics while maximizing performance.

## Core Components

### 1. Task Queue (`src/bun.js/event_loop/Task.zig`)

A tagged pointer union containing various async task types (file I/O, network requests, timers, etc.). Tasks are queued by various subsystems and drained by the main event loop.

### 2. Immediate Tasks (`event_loop.zig:14-15`)

Two separate queues for `setImmediate()`:

- **`immediate_tasks`**: Tasks to run on the current tick
- **`next_immediate_tasks`**: Tasks to run on the next tick

This prevents infinite loops when `setImmediate` is called within a `setImmediate` callback.

### 3. Concurrent Task Queue (`event_loop.zig:17`)

Thread-safe queue for tasks enqueued from worker threads or async operations. These are moved to the main task queue before processing.

### 4. Deferred Task Queue (`src/bun.js/event_loop/DeferredTaskQueue.zig`)

For operations that should be batched and deferred until after microtasks drain (e.g., buffered HTTP response writes, file sink flushes). This avoids excessive system calls while maintaining responsiveness.

### 5. Process.nextTick Queue (`src/bun.js/bindings/JSNextTickQueue.cpp`)

Node.js-compatible implementation of `process.nextTick()`, which runs before microtasks but after each task.

### 6. Microtask Queue (JavaScriptCore VM)

Built-in JSC microtask queue for promises and queueMicrotask.

## Event Loop Flow

### Main Tick Flow (`event_loop.zig:477-513`)

```
┌─────────────────────────────────────┐
│  1. Tick concurrent tasks           │ ← Move tasks from concurrent queue
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  2. Process GC timer                │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  3. Drain regular task queue        │ ← tickQueueWithCount()
│     For each task:                  │
│       - Run task                    │
│       - Release weak refs           │
│       - Drain microtasks            │
│     (See detailed flow below)       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  4. Handle rejected promises        │
└─────────────────────────────────────┘
```

### autoTick Flow (`event_loop.zig:349-401`)

This is called when the event loop is active and needs to wait for I/O:

```
┌─────────────────────────────────────┐
│  1. Tick immediate tasks            │ ← setImmediate() callbacks
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  2. Update date header timer        │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  3. Process GC timer                │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  4. Poll I/O via uSockets            │ ← epoll_wait/kevent with timeout
│     (epoll_kqueue.c:251-320)        │
│     - Dispatch ready polls          │
│     - Each I/O event treated as task│
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  5. Drain timers (POSIX)            │ ← setTimeout/setInterval callbacks
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  6. Call VM.onAfterEventLoop()      │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  7. Handle rejected promises        │
└─────────────────────────────────────┘
```

## Task Draining Algorithm

### For Regular Tasks (`Task.zig:97-512`)

For each task dequeued from the task queue:

```
┌─────────────────────────────────────────────────────────────┐
│ FOR EACH TASK in task queue:                                │
│                                                              │
│   1. RUN THE TASK (Task.zig:135-506)                        │
│      └─> Execute task.runFromJSThread() or equivalent       │
│                                                              │
│   2. DRAIN MICROTASKS (Task.zig:508)                        │
│      └─> drainMicrotasksWithGlobal()                        │
│          │                                                   │
│          ├─> RELEASE WEAK REFS (event_loop.zig:129)         │
│          │   └─> VM.releaseWeakRefs()                       │
│          │                                                   │
│          ├─> CALL JSC__JSGlobalObject__drainMicrotasks()    │
│          │   (ZigGlobalObject.cpp:2793-2840)                │
│          │   │                                               │
│          │   ├─> IF nextTick queue exists and not empty:    │
│          │   │   └─> Call processTicksAndRejections()       │
│          │   │       (ProcessObjectInternals.ts:295-335)    │
│          │   │       │                                       │
│          │   │       └─> DO-WHILE loop:                     │
│          │   │           ├─> Process ALL nextTick callbacks │
│          │   │           │   (with try/catch & async ctx)   │
│          │   │           │                                   │
│          │   │           └─> drainMicrotasks()              │
│          │   │               (promises, queueMicrotask)     │
│          │   │           WHILE queue not empty              │
│          │   │                                               │
│          │   └─> ALWAYS call vm.drainMicrotasks() again     │
│          │       (safety net for any remaining microtasks)  │
│          │                                                   │
│          └─> RUN DEFERRED TASK QUEUE (event_loop.zig:136-138)│
│              └─> deferred_tasks.run()                       │
│                  (buffered writes, file sink flushes, etc.) │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Key Points

#### Process.nextTick Ordering (`ZigGlobalObject.cpp:2818-2829`)

The process.nextTick queue is special:

- It runs **before** microtasks
- After processing **all** nextTick callbacks in the current batch, microtasks are drained
- This creates batched processing with interleaving between nextTick generations and promises:

```javascript
Promise.resolve().then(() => console.log("promise 1"));
process.nextTick(() => {
  console.log("nextTick 1");
  Promise.resolve().then(() => console.log("promise 2"));
});
process.nextTick(() => console.log("nextTick 2"));

// Output:
// nextTick 1
// nextTick 2
// promise 1
// promise 2
```

If a nextTick callback schedules another nextTick, it goes to the next batch:

```javascript
process.nextTick(() => {
  console.log("nextTick 1");
  process.nextTick(() => console.log("nextTick 3"));
  Promise.resolve().then(() => console.log("promise 2"));
});
process.nextTick(() => console.log("nextTick 2"));
Promise.resolve().then(() => console.log("promise 1"));

// Output:
// nextTick 1
// nextTick 2
// promise 1
// promise 2
// nextTick 3
```

The implementation (`ProcessObjectInternals.ts:295-335`):

```typescript
function processTicksAndRejections() {
  var tock;
  do {
    while ((tock = queue.shift()) !== null) {
      // Run the callback with async context
      try {
        callback(...args);
      } catch (e) {
        reportUncaughtException(e);
      }
    }

    drainMicrotasks(); // ← Drain promises after each batch
  } while (!queue.isEmpty());
}
```

#### Deferred Task Queue (`DeferredTaskQueue.zig:44-61`)

Runs after microtasks to batch operations:

- Used for buffered HTTP writes, file sink flushes
- Prevents re-entrancy issues
- Balances latency vs. throughput

The queue maintains a map of `(pointer, task_fn)` pairs and runs each task. If a task returns `true`, it remains in the queue for the next drain; if `false`, it's removed.

## I/O Polling Integration

### uSockets Event Loop (`epoll_kqueue.c:251-320`)

The I/O poll is integrated into the event loop via `us_loop_run_bun_tick()`:

```
┌─────────────────────────────────────────────────────────────┐
│ us_loop_run_bun_tick():                                      │
│                                                              │
│   1. EMIT PRE-CALLBACK (us_internal_loop_pre)               │
│                                                              │
│   2. CALL Bun__JSC_onBeforeWait(jsc_vm)                     │
│      └─> Notify VM we're about to block                     │
│                                                              │
│   3. POLL I/O                                               │
│      ├─> epoll_pwait2() [Linux]                             │
│      └─> kevent64() [macOS/BSD]                             │
│          └─> Block with timeout until I/O ready             │
│                                                              │
│   4. FOR EACH READY POLL:                                   │
│      │                                                       │
│      ├─> Check events & errors                              │
│      │                                                       │
│      └─> us_internal_dispatch_ready_poll()                  │
│          │                                                   │
│          └─> This enqueues tasks or callbacks that will:    │
│              - Add tasks to the concurrent task queue       │
│              - Eventually trigger drainMicrotasks           │
│                                                              │
│   5. EMIT POST-CALLBACK (us_internal_loop_post)             │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### I/O Events Handling

When I/O becomes ready (socket readable/writable, file descriptor ready):

1. The poll is dispatched via `us_internal_dispatch_ready_poll()` or `Bun__internal_dispatch_ready_poll()`
2. This triggers the appropriate callback **synchronously during the I/O poll phase**
3. The callback may:
   - Directly execute JavaScript (must use `EventLoop.enter()/exit()`)
   - Enqueue a task to the concurrent task queue for later processing
   - Update internal state and return (e.g., `FilePoll.onUpdate()`)
4. If JavaScript is called via `enter()/exit()`, microtasks are drained when `entered_event_loop_count` reaches 0

**Important**: I/O callbacks don't automatically get the microtask draining behavior - they must explicitly wrap JS calls in `enter()/exit()` or use `runCallback()` to ensure proper microtask handling. This is why some I/O operations enqueue tasks to the concurrent queue instead of running JavaScript directly.

## setTimeout and setInterval Ordering

Timers are handled differently based on platform:

### POSIX (`event_loop.zig:396`)

```zig
ctx.timer.drainTimers(ctx);
```

Timers are drained after I/O polling. Each timer callback:

1. Is wrapped in `enter()`/`exit()`
2. Triggers microtask draining after execution
3. Can enqueue new tasks

### Windows

Uses the uv_timer_t mechanism integrated into the uSockets loop.

### Timer vs. setImmediate Ordering

```javascript
setTimeout(() => console.log("timeout"), 0);
setImmediate(() => console.log("immediate"));

// Output is typically:
// immediate
// timeout
```

This is because:

- `setImmediate` runs in `tickImmediateTasks()` before I/O polling
- `setTimeout` fires after I/O polling (even with 0ms)
- However, this can vary based on timing and event loop state

## Enter/Exit Mechanism

The event loop uses a counter to track when to drain microtasks:

```zig
pub fn enter(this: *EventLoop) void {
    this.entered_event_loop_count += 1;
}

pub fn exit(this: *EventLoop) void {
    const count = this.entered_event_loop_count;
    if (count == 1 and !this.virtual_machine.is_inside_deferred_task_queue) {
        this.drainMicrotasksWithGlobal(this.global, this.virtual_machine.jsc_vm) catch {};
    }
    this.entered_event_loop_count -= 1;
}
```

This ensures microtasks are only drained once per top-level event loop task, even if JavaScript calls into native code which calls back into JavaScript multiple times.

## Summary

The Bun event loop processes work in this order:

1. **Immediate tasks** (setImmediate)
2. **I/O polling** (epoll/kqueue)
3. **Timer callbacks** (setTimeout/setInterval)
4. **Regular tasks** from the task queue
   - For each task:
     - Run the task
     - Release weak references
     - Check for nextTick queue
       - If active: Run nextTick callbacks, drain microtasks after each
       - If not: Just drain microtasks
     - Drain deferred task queue
5. **Handle rejected promises**

This architecture ensures:

- ✅ Correct Node.js semantics for process.nextTick vs. promises
- ✅ Efficient batching of I/O operations
- ✅ Minimal microtask latency
- ✅ Prevention of infinite loops from self-enqueueing tasks
- ✅ Proper async context propagation
