# Node.js Trace Events Implementation in Bun

This document describes the implementation of Node.js-compatible trace events in Bun.

## Overview

The trace events feature allows Bun to emit performance and diagnostic events in the Chrome Trace Event Format, compatible with Node.js's `--trace-event-categories` flag.

## Implementation Details

### Files Modified

1. **src/trace_events.zig** - Core trace events module

   - Implements the trace event collector
   - Handles writing events to `node_trace.1.log` in JSON format
   - Supports filtering by categories

2. **src/cli.zig** - Command-line interface

   - Added `--trace-event-categories <STR>` parameter
   - Added `trace_event_categories` field to `RuntimeOptions`
   - Parses the flag and stores the categories

3. **src/bun_js.zig** - Runtime initialization

   - Initializes trace events if categories are specified
   - Emits "Environment" event on startup

4. **src/bun.js/event_loop.zig** - Event loop integration

   - Emits "CheckImmediate" event when checking immediate tasks
   - Emits "RunAndClearNativeImmediates" event when running immediate tasks

5. **src/bun.js/api/Timer.zig** - Timer events

   - Emits "RunTimers" event when draining timers

6. **src/bun.js/VirtualMachine.zig** - VM lifecycle events
   - Emits "BeforeExit" event in `onBeforeExit()`
   - Emits "AtExit" event in `onExit()`
   - Emits "RunCleanup" event during cleanup hook execution
   - Calls `trace_events.deinit()` to flush events before exit

## Trace Event Categories

Currently supports the "node.environment" category which includes:

- **Environment** - Emitted when the VM starts
- **CheckImmediate** - Emitted when checking for immediate tasks
- **RunAndClearNativeImmediates** - Emitted when running immediate tasks
- **RunTimers** - Emitted when running timers
- **BeforeExit** - Emitted before the process exits
- **RunCleanup** - Emitted during cleanup hook execution
- **AtExit** - Emitted at process exit

## Output Format

Events are written to `node_trace.1.log` in the Chrome Trace Event Format:

```json
{
  "traceEvents": [
    {
      "name": "Environment",
      "cat": "node.environment",
      "ph": "I",
      "pid": 12345,
      "tid": 12345,
      "ts": 1234567890
    },
    ...
  ]
}
```

## Usage

```bash
bun --trace-event-categories node.environment script.js
```

This will generate a `node_trace.1.log` file in the current working directory containing the trace events.
