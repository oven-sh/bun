#!/usr/bin/env bun
/**
 * Quick benchmark script to compare Express performance
 * 
 * Run: bun bench-express.ts
 * 
 * This will start three servers and test them sequentially.
 * For more accurate results, use bombardier (see BENCHMARK_README.md)
 */

const TEST_PORT = 3000;
const ITERATIONS = 10000;

async function benchmark(name: string, setup: () => Promise<{ url: string; cleanup: () => void }>) {
  console.log(`\n📊 Benchmarking: ${name}`);
  console.log("=" .repeat(50));
  
  const { url, cleanup } = await setup();
  
  // Warmup
  for (let i = 0; i < 100; i++) {
    await fetch(url);
  }
  
  // Actual benchmark
  const start = performance.now();
  const promises = [];
  for (let i = 0; i < ITERATIONS; i++) {
    promises.push(fetch(url));
  }
  await Promise.all(promises);
  const end = performance.now();
  
  const duration = end - start;
  const rps = (ITERATIONS / duration) * 1000;
  
  console.log(`✅ Completed ${ITERATIONS} requests in ${duration.toFixed(2)}ms`);
  console.log(`🚀 Throughput: ${rps.toFixed(0)} req/s`);
  
  cleanup();
  
  return { name, rps, duration };
}

async function main() {
  console.log("🔬 Express Performance Benchmark");
  console.log("Comparing Express via node:http vs Bun.serve shim\n");
  
  const results = [];
  
  // 1. Express via node:http
  try {
    const express = await import("express");
    const app = express.default();
    app.get("/", (req, res) => res.json({ message: "Hello" }));
    
    const server = app.listen(TEST_PORT);
    const cleanup = () => server.close();
    
    results.push(await benchmark("Express via node:http", async () => ({
      url: `http://localhost:${TEST_PORT}`,
      cleanup,
    })));
    
    await Bun.sleep(100); // Give server time to close
  } catch (e) {
    console.error("❌ Failed to benchmark Express via node:http:", e);
  }
  
  // 2. Express via Bun.serve shim
  try {
    const express = await import("./src/js/thirdparty/express-bun");
    const app = express.default();
    app.get("/", (req, res) => res.json({ message: "Hello" }));
    
    const server = Bun.serve({
      port: TEST_PORT,
      fetch: app.fetch.bind(app),
    });
    
    const cleanup = () => server.stop();
    
    results.push(await benchmark("Express via Bun.serve shim", async () => ({
      url: server.url.href,
      cleanup,
    })));
    
    await Bun.sleep(100);
  } catch (e) {
    console.error("❌ Failed to benchmark Express via Bun.serve shim:", e);
  }
  
  // 3. Pure Bun.serve (baseline)
  try {
    const server = Bun.serve({
      port: TEST_PORT,
      fetch: () => Response.json({ message: "Hello" }),
    });
    
    const cleanup = () => server.stop();
    
    results.push(await benchmark("Pure Bun.serve (baseline)", async () => ({
      url: server.url.href,
      cleanup,
    })));
    
    await Bun.sleep(100);
  } catch (e) {
    console.error("❌ Failed to benchmark Pure Bun.serve:", e);
  }
  
  // Summary
  console.log("\n" + "=".repeat(50));
  console.log("📈 SUMMARY");
  console.log("=".repeat(50));
  
  results.sort((a, b) => b.rps - a.rps);
  
  for (const result of results) {
    const improvement = results.length > 1 
      ? ((result.rps / results[results.length - 1].rps - 1) * 100).toFixed(1)
      : "0";
    console.log(`${result.name.padEnd(35)} ${result.rps.toFixed(0).padStart(8)} req/s (${improvement}% vs slowest)`);
  }
  
  if (results.length >= 2) {
    const shimResult = results.find(r => r.name.includes("Bun.serve shim"));
    const nodeResult = results.find(r => r.name.includes("node:http"));
    
    if (shimResult && nodeResult) {
      const improvement = ((shimResult.rps / nodeResult.rps - 1) * 100).toFixed(1);
      console.log(`\n💡 The shim is ${improvement}% ${shimResult.rps > nodeResult.rps ? "faster" : "slower"} than Express via node:http`);
      
      if (shimResult.rps > nodeResult.rps * 1.1) {
        console.log("✅ Significant improvement! The shim is worth pursuing.");
      } else if (shimResult.rps < nodeResult.rps * 0.9) {
        console.log("⚠️  The shim is slower. Consider closing the PR.");
      } else {
        console.log("⚠️  Minimal difference. The shim may not be worth the maintenance burden.");
      }
    }
  }
}

main().catch(console.error);

