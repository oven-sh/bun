const { Server } = require("net");

console.log("Testing Server.prototype.listen with fd directly");

try {
  const server = new Server();

  server.on("error", function (e) {
    console.log("Error event received:");
    console.log("  message:", e.message);
    console.log("  code:", e.code);

    if (e instanceof Error && ["EINVAL", "ENOTSOCK"].includes(e.code)) {
      console.log("SUCCESS: Got expected async error");
    } else {
      console.log("FAIL: Got unexpected error");
    }
  });

  console.log("About to call server.listen({ fd: 0 })");
  server.listen({ fd: 0 });
  console.log("listen() completed without throwing");

  setTimeout(() => {
    console.log("Test completed");
  }, 200);
} catch (e) {
  console.log("FAIL: Synchronous exception:");
  console.log("  message:", e.message);
  console.log("  code:", e.code);
}
