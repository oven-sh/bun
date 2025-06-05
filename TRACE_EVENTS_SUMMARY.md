# Trace Events Implementation Summary

This document summarizes all the changes made to implement Node.js-compatible trace events in Bun.

## Overview

The goal is to make the `test-trace-events-environment.js` test pass by implementing trace event recording for Node.js environment events.

## Files Changed/Created

### 1. CLI Support - `src/cli.zig`

- Added `--trace-event-categories <STR>` flag to runtime parameters
- Added parsing logic to store the categories in `ctx.runtime_options.trace_event_categories`

### 2. C++ Implementation - `src/bun.js/bindings/trace_events.h` and `trace_events.cpp`

- Created `TraceEventRecorder` singleton class
- Records trace events with name, category, timestamp, and PID
- Writes events to `node_trace.1.log` in Chrome trace format
- Implements category filtering

### 3. Zig Bindings - `src/bun.js/bindings/trace_events_binding.zig`

- Created Zig bindings for the C++ functions
- Exports `TraceEventRecorder.enable()`, `record()`, and `writeToFile()`

### 4. Build Configuration - `cmake/sources/CxxSources.txt`

- Added `src/bun.js/bindings/trace_events.cpp` to the build

### 5. Initialization - `src/bun_js.zig`

- Added trace event initialization when `--trace-event-categories` is specified
- Converts the categories string to WTF::String and enables the recorder

### 6. Lifecycle Event Recording - `src/bun.js/VirtualMachine.zig`

- Added trace event recording in:
  - `onBeforeExit()` - Records "BeforeExit" event
  - `onExit()` - Records "RunCleanup" and "AtExit" events
  - `onAfterEventLoop()` - Records "RunAndClearNativeImmediates" event
  - `globalExit()` - Writes trace events to file before exiting

### 7. Timer Events - `src/bun.js/api/Timer.zig`

- Added "RunTimers" trace event recording in `drainTimers()`

### 8. Immediate Events - `src/bun.js/event_loop.zig`

- Added "CheckImmediate" trace event recording in `tickImmediateTasks()`

## Trace Events Recorded

The implementation records the following Node.js environment trace events:

- `Environment` - When the VM initializes (in bun_js.zig)
- `RunAndClearNativeImmediates` - After event loop iterations
- `CheckImmediate` - When processing immediate tasks
- `RunTimers` - When processing timers
- `BeforeExit` - Before the process exits
- `RunCleanup` - During exit cleanup
- `AtExit` - Final exit event

## Output Format

The trace events are written to `node_trace.1.log` in Chrome trace format:

```json
{
  "traceEvents": [
    {
      "name": "EventName",
      "cat": "node.environment",
      "ph": "I",
      "pid": 12345,
      "tid": 1,
      "ts": 1234567890
    }
  ]
}
```

## Test File

The test `test/js/node/test/parallel/test-trace-events-environment.js` expects:

1. A child process to be spawned with `--trace-event-categories node.environment`
2. The child process to create `node_trace.1.log` in its working directory
3. The file to contain valid JSON with trace events for all expected event names
4. Each event to have the correct PID of the child process

## Build Instructions

To build and test:

```bash
# Add the test file
bun node:test:cp test-trace-events-environment.js

# Build and run
bun bd node:test test-trace-events-environment.js
```

## Known Issues

1. The existing debug build needs to be recompiled with these changes
2. There was an unrelated compilation error in HTTPHeaderMap.cpp that was fixed
3. The test requires a full rebuild to incorporate all the C++ and Zig changes
