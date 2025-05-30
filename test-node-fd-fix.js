// Test script for Node.js test: test-net-listen-fd0.js
// This should fail with an async EINVAL error, not throw an exception

const net = require("net");

let errorCount = 0;
let expectedErrors = 1;

function mustCall(fn) {
  return function (...args) {
    errorCount++;
    return fn.apply(this, args);
  };
}

function mustNotCall() {
  return function () {
    throw new Error("Function was called but should not have been");
  };
}

// Simulate the original test
net
  .createServer(mustNotCall())
  .listen({ fd: 0 })
  .on(
    "error",
    mustCall(function (e) {
      console.log("Error received:", e.message);
      console.log("Error code:", e.code);
      console.log("Error type:", typeof e);
      console.log("Is Error instance:", e instanceof Error);

      if (!(e instanceof Error)) {
        console.log("FAIL: Error is not an Error instance");
        process.exit(1);
      }

      if (!["EINVAL", "ENOTSOCK"].includes(e.code)) {
        console.log("FAIL: Error code is not EINVAL or ENOTSOCK, got:", e.code);
        process.exit(1);
      }

      console.log("SUCCESS: Got expected async error with code", e.code);
    }),
  );

// Check that the expected number of errors occurred
setTimeout(() => {
  if (errorCount !== expectedErrors) {
    console.log("FAIL: Expected", expectedErrors, "errors, but got", errorCount);
    process.exit(1);
  } else {
    console.log("SUCCESS: All assertions passed");
    process.exit(0);
  }
}, 1000);
