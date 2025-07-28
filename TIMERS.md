# Fake Timers Implementation Plan for Bun Test Runner

## Executive Summary

This document provides a comprehensive implementation plan for fake timers in Bun's test runner (`bun:test`), enabling developers to mock and control timer functions for deterministic testing. The implementation will support all major timer APIs including `setTimeout`, `setInterval`, `setImmediate`, `queueMicrotask`, `process.nextTick`, and `Bun.sleep`.

## Background

### Current Timer Implementation in Bun

Bun's timer system is implemented primarily in Zig with the following key components:

1. **Timer.zig** (`/src/bun.js/api/Timer.zig`) - Main timer management system
2. **TimerObjectInternals.zig** - Internal timer state management
3. **EventLoopTimer.zig** - Event loop integration for timers
4. **JSNextTickQueue** - Process.nextTick implementation
5. **queueMicrotask** - Microtask queue implementation

### Sinon Fake Timers Analysis

The Sinon fake timers library provides a comprehensive reference implementation with:

- **Clock Management**: Virtual time progression
- **Timer Interception**: Replace native timer functions with mocked versions
- **Execution Control**: Methods to advance time and run pending timers
- **State Management**: Track and manage scheduled timers
- **Priority Handling**: Proper ordering of timers, immediates, and microtasks

## Implementation Architecture

### Core Components

#### 1. FakeTimersClock (Zig Implementation)

Location: `/src/bun.js/test/FakeTimersClock.zig`

```zig
pub const FakeTimersClock = struct {
    // Virtual time state
    now: i64 = 0,
    start_time: i64,
    
    // Timer storage and management
    timers: std.AutoArrayHashMapUnmanaged(i32, *FakeTimer),
    next_timer_id: i32 = 1,
    
    // Original function references
    original_functions: OriginalTimerFunctions,
    
    // Execution control
    is_enabled: bool = false,
    loop_limit: u32 = 100_000,
    
    // Timer queues by priority
    immediate_queue: std.ArrayListUnmanaged(*FakeTimer),
    microtask_queue: std.ArrayListUnmanaged(*FakeTimer),
    timer_heap: TimerHeap,
    
    pub const OriginalTimerFunctions = struct {
        setTimeout: JSValue,
        clearTimeout: JSValue,
        setInterval: JSValue,
        clearInterval: JSValue,
        setImmediate: JSValue,
        clearImmediate: JSValue,
        queueMicrotask: JSValue,
        nextTick: JSValue,
        sleep: JSValue,
    };
    
    pub fn install(global: *JSGlobalObject, options: InstallOptions) !*FakeTimersClock;
    pub fn uninstall(this: *FakeTimersClock, global: *JSGlobalObject) void;
    pub fn tick(this: *FakeTimersClock, ms: i64) !void;
    pub fn runAll(this: *FakeTimersClock) !void;
    pub fn runOnlyPendingTimers(this: *FakeTimersClock) !void;
    pub fn getTimerCount(this: *FakeTimersClock) u32;
    pub fn clearAllTimers(this: *FakeTimersClock) void;
};
```

#### 2. FakeTimer Structure

```zig
pub const FakeTimer = struct {
    id: i32,
    kind: TimerKind,
    callback: JSValue,
    args: []JSValue,
    delay: u32,
    interval: ?u32, // Some for setInterval
    created_at: i64,
    call_at: i64,
    
    pub const TimerKind = enum {
        timeout,
        interval,
        immediate,
        microtask,
        nextTick,
        sleep,
    };
};
```

#### 3. JavaScript API Integration

Location: `/src/bun.js/test/FakeTimersAPI.zig`

```zig
pub const FakeTimersAPI = struct {
    pub fn useFakeTimers(global: *JSGlobalObject, options: JSValue) JSError!JSValue;
    pub fn useRealTimers(global: *JSGlobalObject) JSError!JSValue;
    pub fn advanceTimersByTime(global: *JSGlobalObject, ms: JSValue) JSError!JSValue;
    pub fn runAllTimers(global: *JSGlobalObject) JSError!JSValue;
    pub fn runOnlyPendingTimers(global: *JSGlobalObject) JSError!JSValue;
    pub fn getTimerCount(global: *JSGlobalObject) JSError!JSValue;
    pub fn setSystemTime(global: *JSGlobalObject, time: JSValue) JSError!JSValue;
};
```

### Implementation Strategy

#### Phase 1: Core Infrastructure

1. **Create FakeTimersClock**: Implement the core virtual time management system
2. **Timer Interception**: Replace global timer functions with fake implementations
3. **Basic Time Control**: Implement `tick()` and basic timer execution

#### Phase 2: Timer Function Implementation

1. **setTimeout/clearTimeout**: Mock implementation storing timers in clock
2. **setInterval/clearInterval**: Repeating timer support
3. **setImmediate/clearImmediate**: Immediate queue implementation
4. **Bun.sleep**: Promise-based timer mocking

#### Phase 3: Microtask Support

1. **queueMicrotask**: Microtask queue integration
2. **process.nextTick**: NextTick queue implementation
3. **Execution Order**: Proper priority handling (timers → immediates → microtasks → nextTick)

#### Phase 4: Advanced Features

1. **Timer Advancement**: `advanceTimersByTime()`, `runAll()`, `runOnlyPendingTimers()`
2. **Time Jumping**: `setSystemTime()` implementation
3. **Clock Management**: Install/uninstall functionality

## Detailed Implementation Plan

### 1. Timer Function Mocking

#### setTimeout/setInterval Mock

```zig
pub fn fakeSetTimeout(global: *JSGlobalObject, callback: JSValue, delay: JSValue, args: JSValue) JSError!JSValue {
    const clock = getFakeClock(global) orelse return original_setTimeout(global, callback, delay, args);
    
    const delay_ms = try delay.toNumber(global);
    const timer_id = clock.next_timer_id;
    clock.next_timer_id += 1;
    
    const fake_timer = try clock.allocator.create(FakeTimer);
    fake_timer.* = FakeTimer{
        .id = timer_id,
        .kind = .timeout,
        .callback = callback,
        .args = try argsToArray(global, args),
        .delay = @intFromFloat(@max(0, delay_ms)),
        .created_at = clock.now,
        .call_at = clock.now + @as(i64, @intFromFloat(@max(0, delay_ms))),
    };
    
    try clock.timers.put(clock.allocator, timer_id, fake_timer);
    clock.timer_heap.insert(fake_timer);
    
    return JSValue.jsNumber(timer_id);
}
```

#### setImmediate Mock

```zig
pub fn fakeSetImmediate(global: *JSGlobalObject, callback: JSValue, args: JSValue) JSError!JSValue {
    const clock = getFakeClock(global) orelse return original_setImmediate(global, callback, args);
    
    const timer_id = clock.next_timer_id;
    clock.next_timer_id += 1;
    
    const fake_timer = try clock.allocator.create(FakeTimer);
    fake_timer.* = FakeTimer{
        .id = timer_id,
        .kind = .immediate,
        .callback = callback,
        .args = try argsToArray(global, args),
        .delay = 0,
        .created_at = clock.now,
        .call_at = clock.now,
    };
    
    try clock.timers.put(clock.allocator, timer_id, fake_timer);
    try clock.immediate_queue.append(clock.allocator, fake_timer);
    
    return JSValue.jsNumber(timer_id);
}
```

#### queueMicrotask Mock

```zig
pub fn fakeQueueMicrotask(global: *JSGlobalObject, callback: JSValue) JSError!JSValue {
    const clock = getFakeClock(global) orelse {
        global.queueMicrotask(callback, &.{});
        return JSValue.jsUndefined();
    };
    
    const timer_id = clock.next_timer_id;
    clock.next_timer_id += 1;
    
    const fake_timer = try clock.allocator.create(FakeTimer);
    fake_timer.* = FakeTimer{
        .id = timer_id,
        .kind = .microtask,
        .callback = callback,
        .args = &.{},
        .delay = 0,
        .created_at = clock.now,
        .call_at = clock.now,
    };
    
    try clock.timers.put(clock.allocator, timer_id, fake_timer);
    try clock.microtask_queue.append(clock.allocator, fake_timer);
    
    return JSValue.jsUndefined();
}
```

### 2. Timer Execution Engine

#### Timer Advancement Logic

```zig
pub fn tick(this: *FakeTimersClock, milliseconds: i64) !void {
    if (milliseconds < 0) return error.NegativeTime;
    
    const target_time = this.now + milliseconds;
    var loops: u32 = 0;
    
    while (this.now < target_time and loops < this.loop_limit) {
        loops += 1;
        
        // 1. Execute any timers that should fire
        while (this.getNextTimer()) |timer| {
            if (timer.call_at > target_time) break;
            
            this.now = timer.call_at;
            try this.executeTimer(timer);
        }
        
        // 2. Execute immediates
        try this.executeImmediates();
        
        // 3. Execute microtasks
        try this.executeMicrotasks();
        
        // 4. If no timers left, jump to target time
        if (this.getNextTimer() == null) {
            this.now = target_time;
            break;
        }
    }
    
    if (loops >= this.loop_limit) {
        return error.InfiniteLoop;
    }
}
```

### 3. JavaScript API Surface

#### Jest-Compatible API

```typescript
// Global Jest-style API
declare global {
  namespace jest {
    function useFakeTimers(options?: {
      now?: number | Date;
      toFake?: string[];
      loopLimit?: number;
    }): void;
    
    function useRealTimers(): void;
    function advanceTimersByTime(msToRun: number): void;
    function runAllTimers(): void;
    function runOnlyPendingTimers(): void;
    function getTimerCount(): number;
    function setSystemTime(time: number | Date): void;
  }
}
```

#### Bun-Specific Extensions

```typescript
// Bun namespace extensions
declare namespace Bun {
  namespace jest {
    function useFakeTimers(options?: FakeTimerOptions): FakeTimersClock;
    function getCurrentClock(): FakeTimersClock | null;
    
    interface FakeTimersClock {
      now: number;
      tick(ms: number): void;
      runAll(): void;
      runOnlyPendingTimers(): void;
      getTimerCount(): number;
      setSystemTime(time: number | Date): void;
      install(): void;
      uninstall(): void;
    }
  }
}
```

## Integration with Bun Test Runner

### Test Environment Setup

```zig
// In test runner initialization
pub fn setupTestEnvironment(this: *TestRunner, global: *JSGlobalObject) !void {
    // Install fake timers API on global object
    const fake_timers_api = try FakeTimersAPI.create(global);
    global.putDirect(
        vm,
        jsc.PropertyName.fromString(vm, "jest"),
        fake_timers_api.toJS(),
        .{}
    );
}
```

### Automatic Cleanup

```zig
// In test runner between tests
pub fn cleanupBetweenTests(this: *TestRunner, global: *JSGlobalObject) void {
    if (FakeTimersClock.getActive(global)) |clock| {
        clock.runOnlyPendingTimers() catch {};
        clock.uninstall(global);
    }
}
```

## Test Cases and Examples

### Basic Timer Mocking

```javascript
import { test, expect, jest } from "bun:test";

test("setTimeout with fake timers", () => {
  jest.useFakeTimers();
  
  const callback = jest.fn();
  setTimeout(callback, 1000);
  
  expect(callback).not.toHaveBeenCalled();
  
  jest.advanceTimersByTime(1000);
  expect(callback).toHaveBeenCalledTimes(1);
  
  jest.useRealTimers();
});
```

### Interval Testing

```javascript
test("setInterval with fake timers", () => {
  jest.useFakeTimers();
  
  const callback = jest.fn();
  const intervalId = setInterval(callback, 100);
  
  jest.advanceTimersByTime(350);
  expect(callback).toHaveBeenCalledTimes(3);
  
  clearInterval(intervalId);
  jest.advanceTimersByTime(100);
  expect(callback).toHaveBeenCalledTimes(3);
  
  jest.useRealTimers();
});
```

### Microtask and NextTick Testing

```javascript
test("microtask and nextTick ordering", async () => {
  jest.useFakeTimers();
  
  const calls = [];
  
  setTimeout(() => calls.push("timeout"), 0);
  setImmediate(() => calls.push("immediate"));
  queueMicrotask(() => calls.push("microtask"));
  process.nextTick(() => calls.push("nextTick"));
  
  jest.runOnlyPendingTimers();
  
  expect(calls).toEqual([
    "timeout",
    "immediate", 
    "microtask",
    "nextTick"
  ]);
  
  jest.useRealTimers();
});
```

### Bun.sleep Testing

```javascript
test("Bun.sleep with fake timers", async () => {
  jest.useFakeTimers();
  
  const startTime = Date.now();
  const sleepPromise = Bun.sleep(1000);
  
  // Promise should not resolve immediately
  expect(await Promise.race([
    sleepPromise.then(() => "resolved"),
    Promise.resolve("not-resolved")
  ])).toBe("not-resolved");
  
  jest.advanceTimersByTime(1000);
  
  const result = await sleepPromise;
  expect(result).toBeUndefined();
  
  jest.useRealTimers();
});
```

### Infinite Timer Detection

```javascript
test("infinite timer detection", () => {
  jest.useFakeTimers({ loopLimit: 10 });
  
  const createRecursiveTimer = () => {
    setTimeout(createRecursiveTimer, 0);
  };
  
  createRecursiveTimer();
  
  expect(() => {
    jest.runAllTimers();
  }).toThrow(/infinite loop/i);
  
  jest.useRealTimers();
});
```

## File Structure

```
src/bun.js/test/
├── FakeTimersClock.zig          # Core fake timers clock implementation
├── FakeTimersAPI.zig            # JavaScript API bindings
├── FakeTimer.zig                # Individual timer representation
└── fake-timers-integration.zig  # Integration with test runner

src/bun.js/bindings/
├── JSFakeTimersAPI.cpp          # C++ bindings for JS integration
└── JSFakeTimersAPI.h

test/js/bun/test/
├── fake-timers.test.ts          # Core fake timers functionality tests
├── fake-timers-microtasks.test.ts # Microtask integration tests
├── fake-timers-integration.test.ts # Integration with bun:test
└── fake-timers-edge-cases.test.ts # Edge cases and error conditions
```

## Performance Considerations

### Memory Management

1. **Timer Storage**: Use arena allocator for timer objects to improve cleanup
2. **Callback References**: Careful management of JSValue references to prevent leaks
3. **Queue Optimization**: Efficient data structures for timer queues

### Execution Performance

1. **Heap Implementation**: Use binary heap for timer ordering
2. **Batch Execution**: Process multiple timers at the same virtual time
3. **Lazy Cleanup**: Defer cleanup of cancelled timers

## Error Handling

### Runtime Errors

1. **Infinite Loops**: Detect and prevent infinite timer recursion
2. **Memory Limits**: Graceful handling of excessive timer creation
3. **Invalid Arguments**: Proper validation of timer arguments

### Development Errors

1. **Clear Error Messages**: Descriptive errors for common mistakes
2. **Debugging Support**: Timer inspection and debugging utilities
3. **Stack Traces**: Preserve original call stacks in timer callbacks

## Compatibility Considerations

### Jest Compatibility

- Support all major Jest fake timer methods
- Maintain similar behavior for edge cases
- Compatible error messages and warnings

### Node.js Compatibility

- Proper timer ID types and return values
- Correct timer behavior for edge cases
- Support for Node.js-specific timer features

### Bun-Specific Features

- Integration with `Bun.sleep()`
- Support for Bun's async context tracking
- Performance optimizations specific to Bun's runtime

## Implementation Phases

### Phase 1 (Core - Week 1-2)
- [ ] `FakeTimersClock` basic implementation
- [ ] `setTimeout`/`clearTimeout` mocking
- [ ] Basic `tick()` functionality
- [ ] Install/uninstall mechanism

### Phase 2 (Timer APIs - Week 3)
- [ ] `setInterval`/`clearInterval` support
- [ ] `setImmediate`/`clearImmediate` support
- [ ] `Bun.sleep()` integration
- [ ] Timer execution order implementation

### Phase 3 (Microtasks - Week 4)
- [ ] `queueMicrotask` mocking
- [ ] `process.nextTick` integration
- [ ] Proper execution priority handling
- [ ] Microtask queue management

### Phase 4 (Advanced Features - Week 5)
- [ ] `runAllTimers()` implementation
- [ ] `runOnlyPendingTimers()` implementation
- [ ] `setSystemTime()` support
- [ ] Infinite loop detection

### Phase 5 (Testing & Polish - Week 6)
- [ ] Comprehensive test suite
- [ ] Performance optimization
- [ ] Documentation completion
- [ ] Integration testing with real projects

## Success Criteria

1. **Functional Compatibility**: All Jest fake timer APIs work correctly
2. **Performance**: Minimal overhead when fake timers are disabled
3. **Integration**: Seamless integration with existing `bun:test` infrastructure
4. **Reliability**: Handles edge cases and error conditions gracefully
5. **Developer Experience**: Clear APIs and helpful error messages

## Conclusion

This implementation plan provides a comprehensive approach to adding fake timer support to Bun's test runner. By closely following Sinon's architecture while adapting to Bun's specific runtime characteristics, we can deliver a robust, performant, and developer-friendly fake timer system that enhances Bun's testing capabilities significantly.

The phased approach ensures that core functionality is delivered early while advanced features are built incrementally. The extensive test coverage and Jest compatibility will ensure that existing Jest users can easily migrate to using Bun for their testing needs.