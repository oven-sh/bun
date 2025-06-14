import { test } from "bun:test";

// Store original prepareStackTrace
const originalPrepareStackTrace = Error.prepareStackTrace;

test("segfault reproduction - Error.prepareStackTrace with stack access", async () => {
  // Set up Error.prepareStackTrace that accesses the error stack
  Error.prepareStackTrace = function(err, stack) {
    // CRITICAL: Access the error stack inside Error.prepareStackTrace
    // This is specifically what Jarred requested
    try {
      // Access stack frames to trigger populateStackTrace conditions
      for (let i = 0; i < stack.length; i++) {
        const frame = stack[i];
        if (frame) {
          // Access frame properties that could trigger the segfault
          frame.getFileName?.();
          frame.getFunctionName?.();
          frame.getLineNumber?.();
          frame.getColumnNumber?.();
          frame.getThis?.();
          frame.getTypeName?.();
          frame.getMethodName?.();
          frame.isNative?.();
          frame.isToplevel?.();
          frame.isEval?.();
          frame.isConstructor?.();
        }
      }
    } catch (e) {
      // Ignore errors during stack access
    }
    
    // Return formatted stack trace
    return originalPrepareStackTrace 
      ? originalPrepareStackTrace(err, stack)
      : err.name + ": " + err.message + "\n" + stack.map(frame => "    at " + frame).join("\n");
  };
  
  // Async test completes normally
  await new Promise(resolve => setTimeout(resolve, 10));
  
  // Schedule unhandled exception AFTER test completion
  // This targets the TestRunnerTask.onUnhandledRejection path
  setTimeout(() => {
    // Create error that will trigger stack trace population
    const error = new Error("Segfault reproduction error");
    
    // Force stack trace access which should trigger Error.prepareStackTrace
    error.stack;
    
    // Create unhandled promise rejection
    Promise.reject(error);
  }, 50); // After test completion
  
  // Test finishes here, but setTimeout will fire after
});

test("segfault reproduction variant - promise rejection chain", async () => {
  // More complex Error.prepareStackTrace with intensive stack access
  Error.prepareStackTrace = function(err, stack) {
    try {
      // Access the error stack more aggressively
      const stackInfo = [];
      for (let frame of stack) {
        if (frame) {
          // Store results to force evaluation
          stackInfo.push({
            fileName: frame.getFileName(),
            functionName: frame.getFunctionName(),
            lineNumber: frame.getLineNumber(),
            columnNumber: frame.getColumnNumber(),
            thisValue: frame.getThis(),
            typeName: frame.getTypeName(),
            methodName: frame.getMethodName(),
            isNative: frame.isNative(),
            isToplevel: frame.isToplevel(),
            isEval: frame.isEval(),
            isConstructor: frame.isConstructor()
          });
        }
      }
      // Force string conversion of all frame data
      JSON.stringify(stackInfo);
    } catch (e) {
      // Create nested error during stack processing
      const nestedError = new Error("Nested error during stack trace: " + e.message);
      nestedError.stack; // This could trigger recursion issues
    }
    
    return originalPrepareStackTrace 
      ? originalPrepareStackTrace(err, stack)
      : "Stack trace with " + stack.length + " frames";
  };
  
  await Promise.resolve();
  
  // Multiple async operations that could trigger the error path
  setTimeout(() => {
    // Chain of promise rejections
    Promise.reject(new Error("First error"))
      .catch(err => {
        // Access stack during error handling
        err.stack;
        throw new Error("Second error");
      })
      .catch(err => {
        // Another stack access
        err.stack;
        throw err; // Re-throw to create unhandled rejection
      });
  }, 30);
  
  setTimeout(() => {
    // Nested setTimeout with error
    setTimeout(() => {
      const err = new Error("Nested timeout error");
      err.stack; // Trigger stack trace
      throw err; // Unhandled exception
    }, 20);
  }, 40);
  
  // Allow async operations to complete
  await new Promise(resolve => setTimeout(resolve, 50));
});