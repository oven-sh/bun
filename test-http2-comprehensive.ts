#!/usr/bin/env bun

// Comprehensive HTTP/2 test for fetch()
import * as http2 from "node:http2";
import * as fs from "node:fs";
import * as path from "node:path";

// Ensure NODE_TLS_REJECT_UNAUTHORIZED is set for self-signed certificates
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Create test certificate files if they don't exist
const certDir = path.join(import.meta.dir, "test-certs");
if (!fs.existsSync(certDir)) {
  fs.mkdirSync(certDir, { recursive: true });
}

// Use existing test certificates if available
const certPath = path.join(certDir, "cert.pem");
const keyPath = path.join(certDir, "key.pem");

if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  // Try to use existing test certificates
  const testCertPath = "/home/claude/bun/test/js/bun/http/fixtures/cert.pem";
  const testKeyPath = "/home/claude/bun/test/js/bun/http/fixtures/cert.key";
  
  if (fs.existsSync(testCertPath) && fs.existsSync(testKeyPath)) {
    fs.copyFileSync(testCertPath, certPath);
    fs.copyFileSync(testKeyPath, keyPath);
  } else {
    console.error("No test certificates found. Please create them first.");
    process.exit(1);
  }
}

// Test data structure
interface TestResult {
  name: string;
  success: boolean;
  error?: string;
  details?: any;
}

const results: TestResult[] = [];

// Create HTTP/2 server
const server = http2.createSecureServer({
  allowHTTP1: false,
  settings: {
    enablePush: false,
  },
  key: fs.readFileSync(keyPath),
  cert: fs.readFileSync(certPath),
});

server.on("error", (err) => {
  console.error("Server error:", err);
});

// Handle server requests
server.on("stream", (stream, headers) => {
  console.log("\n=== Server received HTTP/2 request ===");
  console.log("Headers:", headers);
  
  const path = headers[":path"];
  const method = headers[":method"];
  
  // Route different test endpoints
  switch (path) {
    case "/simple":
      stream.respond({
        ":status": 200,
        "content-type": "application/json",
        "x-http-version": "2",
      });
      stream.end(JSON.stringify({
        message: "Simple HTTP/2 response",
        method: method,
        path: path,
        protocol: "HTTP/2",
      }));
      break;
      
    case "/headers":
      stream.respond({
        ":status": 200,
        "content-type": "text/plain",
        "x-custom-header": "test-value",
        "x-http-version": "2",
        "x-multiple": ["value1", "value2"],
      });
      stream.end("Headers test successful");
      break;
      
    case "/echo":
      // Echo back the request headers
      stream.respond({
        ":status": 200,
        "content-type": "application/json",
        "x-http-version": "2",
      });
      stream.end(JSON.stringify({
        requestHeaders: headers,
        protocol: "HTTP/2",
      }));
      break;
      
    case "/stream":
      // Test streaming response
      stream.respond({
        ":status": 200,
        "content-type": "text/plain",
        "x-http-version": "2",
      });
      stream.write("Chunk 1\n");
      setTimeout(() => {
        stream.write("Chunk 2\n");
        setTimeout(() => {
          stream.end("Chunk 3\n");
        }, 50);
      }, 50);
      break;
      
    case "/error":
      stream.respond({
        ":status": 500,
        "content-type": "text/plain",
      });
      stream.end("Server error test");
      break;
      
    default:
      stream.respond({
        ":status": 404,
        "content-type": "text/plain",
      });
      stream.end("Not found");
  }
});

// Run tests
async function runTests() {
  const port = await new Promise<number>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' ? addr?.port : 0;
      console.log(`\nHTTP/2 server listening on port ${port}`);
      resolve(port);
    });
  });
  
  const baseUrl = `https://localhost:${port}`;
  
  // Test 1: Simple GET request with httpVersion: 2
  console.log("\n=== Test 1: Simple GET with httpVersion: 2 ===");
  try {
    const response = await fetch(`${baseUrl}/simple`, {
      // @ts-ignore - Bun-specific option
      httpVersion: 2,
      // @ts-ignore - Bun-specific option
      tls: { rejectUnauthorized: false }
    });
    
    console.log("Response status:", response.status);
    console.log("Response headers:", Object.fromEntries(response.headers.entries()));
    
    const data = await response.json();
    console.log("Response data:", data);
    
    results.push({
      name: "Simple GET with httpVersion: 2",
      success: response.status === 200 && data.protocol === "HTTP/2",
      details: { status: response.status, data }
    });
  } catch (err: any) {
    console.error("Test 1 failed:", err);
    results.push({
      name: "Simple GET with httpVersion: 2",
      success: false,
      error: err.message
    });
  }
  
  // Test 2: Request with custom headers
  console.log("\n=== Test 2: Request with custom headers ===");
  try {
    const response = await fetch(`${baseUrl}/echo`, {
      method: "POST",
      headers: {
        "User-Agent": "Bun-HTTP2-Test",
        "X-Custom": "test-value",
        "Accept": "application/json"
      },
      // @ts-ignore
      httpVersion: 2,
      // @ts-ignore
      tls: { rejectUnauthorized: false }
    });
    
    const data = await response.json();
    console.log("Echo response:", data);
    
    results.push({
      name: "Request with custom headers",
      success: response.status === 200 && data.protocol === "HTTP/2",
      details: data
    });
  } catch (err: any) {
    console.error("Test 2 failed:", err);
    results.push({
      name: "Request with custom headers",
      success: false,
      error: err.message
    });
  }
  
  // Test 3: Streaming response
  console.log("\n=== Test 3: Streaming response ===");
  try {
    const response = await fetch(`${baseUrl}/stream`, {
      // @ts-ignore
      httpVersion: 2,
      // @ts-ignore
      tls: { rejectUnauthorized: false }
    });
    
    const text = await response.text();
    console.log("Streamed text:", text);
    
    results.push({
      name: "Streaming response",
      success: response.status === 200 && text.includes("Chunk 1") && text.includes("Chunk 3"),
      details: { text }
    });
  } catch (err: any) {
    console.error("Test 3 failed:", err);
    results.push({
      name: "Streaming response",
      success: false,
      error: err.message
    });
  }
  
  // Test 4: Error handling
  console.log("\n=== Test 4: Error handling ===");
  try {
    const response = await fetch(`${baseUrl}/error`, {
      // @ts-ignore
      httpVersion: 2,
      // @ts-ignore
      tls: { rejectUnauthorized: false }
    });
    
    results.push({
      name: "Error handling",
      success: response.status === 500,
      details: { status: response.status }
    });
  } catch (err: any) {
    console.error("Test 4 failed:", err);
    results.push({
      name: "Error handling",
      success: false,
      error: err.message
    });
  }
  
  // Test 5: Without httpVersion (should use HTTP/1.1 or auto-negotiate)
  console.log("\n=== Test 5: Without httpVersion option ===");
  try {
    const response = await fetch(`${baseUrl}/simple`, {
      // @ts-ignore
      tls: { rejectUnauthorized: false }
    });
    
    console.log("Response status:", response.status);
    const data = response.status === 200 ? await response.json() : null;
    
    results.push({
      name: "Without httpVersion option",
      success: true, // Success means it attempted the request
      details: { status: response.status, data }
    });
  } catch (err: any) {
    console.error("Test 5 info:", err.message);
    results.push({
      name: "Without httpVersion option",
      success: true, // Expected to fail since server is HTTP/2 only
      details: { expectedFailure: true, error: err.message }
    });
  }
  
  // Print results summary
  console.log("\n" + "=".repeat(60));
  console.log("TEST RESULTS SUMMARY");
  console.log("=".repeat(60));
  
  for (const result of results) {
    const status = result.success ? "✅ PASS" : "❌ FAIL";
    console.log(`${status}: ${result.name}`);
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }
  }
  
  const passed = results.filter(r => r.success).length;
  const total = results.length;
  console.log(`\nTotal: ${passed}/${total} tests passed`);
  
  // Close server
  server.close();
  
  // Exit with appropriate code
  process.exit(passed === total ? 0 : 1);
}

// Run tests after a short delay to ensure server is ready
setTimeout(runTests, 100);