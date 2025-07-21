# AbortSignal Support in Bun Shell Implementation

## Overview

This implementation adds AbortSignal support to Bun Shell, allowing users to cancel long-running shell commands using the standard Web API AbortSignal interface.

## API Usage

```typescript
const controller = new AbortController();

// Basic usage
const cmd = $`long-running-command`.signal(controller.signal);

// Method chaining
const cmd2 = $`command`
  .cwd("/tmp")
  .signal(controller.signal)
  .env({ VAR: "value" });

// Abort the command
setTimeout(() => controller.abort(), 1000);

try {
  await cmd;
} catch (error) {
  console.log("Command was aborted:", error.exitCode === 128);
}
```

## Implementation Details

### 1. JavaScript API Changes

**File: `src/js/builtins/shell.ts`**
- Added `signal(abortSignal: AbortSignal | undefined): this` method to `ShellPromise` class
- Method validates the signal and passes it to the underlying `ParsedShellScript`

### 2. ParsedShellScript Updates

**File: `src/shell/ParsedShellScript.zig`**
- Added `abort_signal: ?*JSC.WebCore.AbortSignal` field
- Added `setAbortSignal()` method to set the signal from JavaScript
- Updated `take()` method to pass the signal to the interpreter
- Added proper cleanup in `finalize()` method

### 3. Interpreter Integration

**File: `src/shell/interpreter.zig`**
- Added `abort_signal: ?*JSC.WebCore.AbortSignal` field to `Interpreter` struct
- Updated `init()` method signature to accept abort signal parameter
- Added `isAborted()` helper method to check signal state
- Added abort checking at interpreter entry points (`run()` and `runFromJS()`)
- Added proper cleanup in all deinit methods

### 4. State Machine Abort Checks

**File: `src/shell/states/Script.zig`**
- Added abort checking in `next()` method before executing statements
- Returns exit code 128 (signal termination) when aborted

**File: `src/shell/states/Cmd.zig`**
- Added abort checking in `next()` method before command execution
- Ensures individual commands can be cancelled mid-execution

## Error Handling

When a command is aborted:
- Exit code is set to 128 (following Unix convention for signal termination)
- The shell error is propagated as a `ShellErr` with syscall error code `CANCELED`
- JavaScript receives the error as a rejected promise

## Memory Management

- AbortSignal references are properly managed with `ref()` and `unref()`
- Cleanup occurs in all interpreter deinit paths
- No memory leaks from retained signal references

## Testing

Comprehensive test suite in `test/js/bun/shell/abort-signal.test.ts` covers:
- Basic signal passing and method chaining
- Immediate abort before command starts  
- Abort during command execution
- Multiple commands with same signal
- Pipeline command abort
- Builtin command abort
- Error vs abort distinction
- Memory cleanup validation
- Edge cases (null/undefined signals)

## Backward Compatibility

- All existing shell command APIs remain unchanged
- The `.signal()` method is optional and doesn't affect existing code
- Commands without abort signals behave exactly as before

## Performance Impact

- Minimal overhead: abort checking only occurs at state transitions
- No impact on commands that don't use abort signals
- AbortSignal checking uses fast native calls

## Standards Compliance

- Follows the W3C AbortSignal specification
- Compatible with standard AbortController usage patterns
- Works with AbortSignal.timeout() and other standard features

## Integration with Other Bun Features

The implementation follows the same patterns used in:
- Bun's fetch() AbortSignal support
- JSC WebCore AbortSignal bindings  
- Existing Bun shell architecture

This ensures consistency across Bun's APIs and leverages existing infrastructure for AbortSignal handling.