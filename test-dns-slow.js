// Test script to reproduce slow DNS with abort signal
import { createServer } from "dgram";
import { spawn } from "child_process";

// Create a UDP server that acts as a slow DNS server
const dnsServer = createServer("udp4");

dnsServer.on("message", (msg, rinfo) => {
  console.log(`DNS query received from ${rinfo.address}:${rinfo.port}`);

  // Intentionally delay the DNS response by 5 seconds
  // This simulates a very slow DNS resolution
  setTimeout(() => {
    // For simplicity, we're not sending a proper DNS response
    // which will cause the resolver to timeout/fail eventually
    console.log("Would send DNS response now (but we won't to force timeout)");
  }, 5000);
});

dnsServer.bind(15353, "127.0.0.1", () => {
  console.log("Slow DNS server listening on 127.0.0.1:15353");

  // Now test fetch with a custom DNS resolver pointing to our slow server
  testFetchWithAbort();
});

async function testFetchWithAbort() {
  console.log("\n=== Testing fetch with abort signal (1 second timeout) ===");

  // We need to test with a domain that will use our slow DNS
  // This requires system-level DNS configuration which is complex
  // Instead, let's test with a direct approach

  console.time("fetch-with-abort");
  try {
    // Using a domain that's likely to have slow DNS resolution
    // or we can use a non-routable IP that will hang
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log("Aborting fetch due to timeout");
      controller.abort();
    }, 1000);

    const response = await fetch("http://10.255.255.254:8080", {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    console.log("Fetch succeeded:", response.status);
  } catch (error) {
    console.log("Fetch error:", error.name, error.message);
  } finally {
    console.timeEnd("fetch-with-abort");
    dnsServer.close();
  }
}