# INotify Watcher Fixes for Linux

## Issues Fixed

### 1. Futex Deadlock on Zero Watch Count

- **Problem**: `Futex.waitForever(&this.watch_count, 0)` would wait forever when `watch_count` was 0, causing timeouts
- **Fix**: Added checks for `watch_count == 0` before calling `Futex.waitForever`
- **Files**: `src/watcher/INotifyWatcher.zig` lines 117-124

### 2. Missing read_ptr Reset

- **Problem**: `read_ptr` was not cleared after processing all buffered events, causing infinite loops on subsequent reads
- **Fix**: Added `this.read_ptr = null` after processing all events
- **Files**: `src/watcher/INotifyWatcher.zig` line 221

### 3. Event Offset Not Advanced

- **Problem**: In `watchLoopCycle`, the event processing loop always started from index 0, causing infinite loops when processing multiple batches
- **Fix**: Added `event_offset` variable and properly advance it through the event array
- **Files**: `src/watcher/INotifyWatcher.zig` lines 241, 252, 304-305

### 4. Stop Function Not Waking Threads

- **Problem**: When stopping the watcher, threads waiting on `watch_count` would not be woken up
- **Fix**: Added `Futex.wake(&this.watch_count, 10)` in the stop function
- **Files**: `src/watcher/INotifyWatcher.zig` line 232

### 5. File Descriptor Check After Wait

- **Problem**: After waking from Futex wait, the file descriptor might be closed but the code would still try to read from it
- **Fix**: Added checks for `this.fd == bun.invalid_fd` after Futex wait returns
- **Files**: `src/watcher/INotifyWatcher.zig` lines 119, 125

## Test Results

The fixes address the timeout issues in the following tests:

- `test-fs-watch-recursive-delete.js` - No longer times out
- Other fs.watch tests on Linux should also be more stable

## Key Changes Summary

```zig
// Before:
Futex.waitForever(&this.watch_count, 0);

// After:
const count = this.watch_count.load(.acquire);
if (count == 0) return .{ .result = &.{} };
Futex.waitForever(&this.watch_count, 0);
if (this.fd == bun.invalid_fd) return .{ .result = &.{} };
```

```zig
// Added in stop():
Futex.wake(&this.watch_count, 10);
```

```zig
// Added after processing events:
this.read_ptr = null;
```

```zig
// Fixed event processing loop:
var event_offset: usize = 0;
// ...
event_offset += slice.len;
```

These changes ensure that:

1. The watcher doesn't deadlock when there are no watches
2. Events are properly processed without infinite loops
3. The watcher can be cleanly stopped without hanging threads
4. File descriptor validity is checked after blocking operations
