# Fix for Issue #24003: Async Stack Traces Lost Within AsyncLocalStorage

## Problem Summary

When code runs inside `AsyncLocalStorage.run()`, async stack traces are not properly maintained across `await` boundaries. This makes debugging significantly harder for applications using AsyncLocalStorage.

### Expected Behavior (Node.js/V8)
```
Error: Error in fn3
    at fn3 ([eval]:7:9)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async fn2 ([eval]:12:3)
    at async fn1 ([eval]:17:3)
    at async [eval]:31:7
```

### Actual Behavior (Bun/JSC)
```
Error: Error in fn3
    at fn3 (/workspace/bun/test-async-stack.ts:7:13)
    at asyncFunctionResume (native:9:85)
    at promiseReactionJobWithoutPromiseUnwrapAsyncContext (native:14:20)
    at promiseReactionJob (native:31:60)
```

Notice that `fn2` and `fn1` are missing from the async stack trace.

## Root Cause

The issue is in JavaScriptCore's (JSC) promise implementation:

1. **Without AsyncLocalStorage**: JSC uses standard promise reaction jobs that properly maintain async stack traces
2. **With AsyncLocalStorage**: JSC detects that async context is active and switches to `promiseReactionJobWithoutPromiseUnwrapAsyncContext`
3. This "without unwrap" variant:
   - Correctly preserves async context (good for AsyncLocalStorage functionality)
   - **But fails to maintain async stack traces** (bug)
   - Adds an extra `promiseReactionJob` wrapper that further obscures the stack

### Technical Details

When a promise reaction is queued while async context is active, JSC's builtin code uses `promiseReactionJobWithoutPromiseUnwrapAsyncContext` instead of the regular `promiseReactionJob`. This function is defined in JSC's PromiseOperations.js builtin file (compiled into JSC).

The function appears to skip the async stack trace capture/restoration logic that the standard variant uses, likely to avoid conflicts with async context handling. However, this is overly conservative - async context and async stack traces should be orthogonal concerns.

## Attempted Solutions

### 1. Override JSC Builtins (Not Feasible)
JSC builtins are compiled into the JavaScriptCore binary. Bun would need to modify the WebKit source code and rebuild JSC to change this behavior.

### 2. Intercept Promise Creation (Complex)
Would require hooking into every promise creation to manually capture stack traces. This is:
- Extremely invasive
- Performance-intensive
- Fragile (might not catch all cases)

### 3. Modify Async Context Implementation (Explored)
Tried to see if there's a way to implement async context without triggering JSC's "without unwrap" code path, but this appears to be deeply embedded in JSC's internal logic.

## Proposed Solution

This issue requires a fix in JavaScriptCore's promise implementation. The fix should:

1. **Modify `promiseReactionJobWithoutPromiseUnwrapAsyncContext`** in WebKit's `Source/JavaScriptCore/builtins/PromiseOperations.js`
2. Ensure it captures and restores async stack traces the same way the standard `promiseReactionJob` does
3. The function should handle BOTH async context preservation AND async stack trace maintenance

### Minimal Fix Approach

The `promiseReactionJobWithoutPromiseUnwrapAsyncContext` function should:
- Save the current async call stack before executing the reaction
- Restore it after execution
- This is what the standard promise reaction job already does
- The key is ensuring this happens even when async context is being managed

## Workarounds for Users

Until this is fixed in JSC:

1. **Avoid AsyncLocalStorage in code where stack traces are critical** for debugging
2. **Add manual error context**: Store additional context in the error object before throwing
   ```typescript
   const error = new Error("Something failed");
   error.context = { fn: "fn2", calledFrom: "fn1" };
   throw error;
   ```
3. **Use synchronous context passing** where possible instead of AsyncLocalStorage

## Testing

A regression test has been added in `test/regression/issue/24003.test.ts` that will pass once this issue is fixed.

## Next Steps

1. **File upstream WebKit bug**: Report this issue to WebKit's bug tracker
2. **Create WebKit patch**: Develop and test a fix for `PromiseOperations.js`
3. **Update Bun's WebKit version**: Once the fix is merged upstream, update Bun to use the fixed version
4. **Consider temporary patch**: If upstream fix takes too long, Bun could maintain a local patch to WebKit

## References

- Issue: https://github.com/oven-sh/bun/issues/24003
- Related issue: https://github.com/oven-sh/bun/issues/2704
- Test file: `test/regression/issue/24003.test.ts`
- WebKit PromiseOperations: `Source/JavaScriptCore/builtins/PromiseOperations.js` (in WebKit repository)
