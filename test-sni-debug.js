const tls = require("tls");

console.log("Debug SNI Callback validation...");

try {
  console.log("Testing with string value...");
  const server = tls.createServer({
    SNICallback: "not-a-function"
  });
  console.log("ERROR: Should have thrown!");
  server.close();
} catch (error) {
  console.log("Caught error:", error.message);
  console.log("Error type:", error.constructor.name);
  console.log("Full error:", error);
}

try {
  console.log("\nTesting with number value...");
  const server = tls.createServer({
    SNICallback: 123
  });
  console.log("ERROR: Should have thrown!");
  server.close();
} catch (error) {
  console.log("Caught error:", error.message);
  console.log("Error type:", error.constructor.name);
}

try {
  console.log("\nTesting with valid function...");
  const server = tls.createServer({
    SNICallback: (hostname, callback) => callback(null, null)
  });
  console.log("SUCCESS: Server created with valid SNICallback");
  console.log("SNICallback type:", typeof server.SNICallback);
  server.close();
} catch (error) {
  console.log("Unexpected error:", error.message);
}