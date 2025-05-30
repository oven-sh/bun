const net = require("net");

console.log("Testing net.createServer().listen({ fd: 0 })");

let errorReceived = false;

try {
  const server = net.createServer();

  server.on("error", function (e) {
    console.log("Error event received:");
    console.log("  message:", e.message);
    console.log("  code:", e.code);
    console.log("  errno:", e.errno);
    console.log("  syscall:", e.syscall);
    console.log("  fd:", e.fd);
    errorReceived = true;

    // Check if error is expected
    if (e instanceof Error && ["EINVAL", "ENOTSOCK"].includes(e.code)) {
      console.log("SUCCESS: Got expected async error");
    } else {
      console.log("FAIL: Got unexpected error");
    }
  });

  console.log("About to call listen with fd: 0");
  server.listen({ fd: 0 });
  console.log("listen() call completed without throwing");

  // Wait a bit to see if error is emitted
  setTimeout(() => {
    if (!errorReceived) {
      console.log("FAIL: No error received");
    }
  }, 200);
} catch (e) {
  console.log("FAIL: Synchronous exception thrown:");
  console.log("  message:", e.message);
  console.log("  code:", e.code);
}
