// Test abort signal with various hanging scenarios
import { createServer } from "net";

// Test 1: Server that accepts connection but never responds
async function testHangingServer() {
  const server = createServer((socket) => {
    console.log("Client connected, but not responding...");
    // Never send any data - just keep the connection open
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  console.log("=== Test 1: Server accepts but never responds ===");
  console.time("fetch-hanging");
  try {
    await fetch(`http://127.0.0.1:${port}`, {
      signal: AbortSignal.timeout(1000),
    });
  } catch (error) {
    console.log("Error:", error.name, error.message);
  } finally {
    console.timeEnd("fetch-hanging");
    server.close();
  }
}

// Test 2: IP address that doesn't exist (connection timeout)
async function testNonRoutableIP() {
  console.log("\n=== Test 2: Non-routable IP (should hang on connect) ===");
  console.time("fetch-nonroutable");
  try {
    // Using a non-routable IP that will cause connection to hang
    await fetch("http://10.255.255.254:8080", {
      signal: AbortSignal.timeout(1000),
    });
  } catch (error) {
    console.log("Error:", error.name, error.message);
  } finally {
    console.timeEnd("fetch-nonroutable");
  }
}

// Test 3: The original problematic domain
async function testSlowDNS() {
  console.log("\n=== Test 3: Domain with slow DNS (original issue) ===");
  console.time("fetch-slowdns");
  try {
    await fetch("http://univ-toulouse.fr", {
      signal: AbortSignal.timeout(1000),
    });
  } catch (error) {
    console.log("Error:", error.name, error.message);
  } finally {
    console.timeEnd("fetch-slowdns");
  }
}

// Test 4: Server that never accepts connections (DROP packets)
async function testDroppedPackets() {
  console.log("\n=== Test 4: Simulated dropped packets (iptables would be needed) ===");
  console.time("fetch-dropped");
  try {
    // This IP is in the TEST-NET-3 range (reserved for documentation)
    // Packets to this should be dropped by most routers
    await fetch("http://203.0.113.1:8080", {
      signal: AbortSignal.timeout(1000),
    });
  } catch (error) {
    console.log("Error:", error.name, error.message);
  } finally {
    console.timeEnd("fetch-dropped");
  }
}

// Run all tests
console.log("Testing abort signal behavior in different scenarios...\n");
await testHangingServer();
await testNonRoutableIP();
await testSlowDNS();
await testDroppedPackets();

console.log("\n✅ All tests completed");