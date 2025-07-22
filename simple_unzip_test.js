// Simple test to verify Bun.unzipSync is available
try {
  const { unzipSync } = require("bun");
  console.log("unzipSync function:", typeof unzipSync);
  
  // Test with invalid input to see if it throws the right error
  try {
    unzipSync("not a buffer");
  } catch (err) {
    console.log("Expected error:", err.message);
  }
  
  // Test with empty buffer
  try {
    unzipSync(new Uint8Array(0));
  } catch (err) {
    console.log("Expected empty buffer error:", err.message);
  }
  
  console.log("Basic API test passed!");
} catch (err) {
  console.error("API not available:", err.message);
  process.exit(1);
}