# Express Bun.serve Shim - Benchmarking Guide

This document explains how to benchmark the Express Bun.serve shim to validate whether it provides meaningful performance improvements over Express via `node:http`.

## Background

This shim is experimental. Contributors have raised valid concerns:
- Express is essentially a router for `node:http` which is already well-implemented in Bun
- Express API design is slow by modern standards and may limit optimization opportunities
- Shims can cause compatibility issues as Express evolves

**Benchmarks are needed to prove this approach is worth pursuing.**

## Benchmarking Approach

### Option 1: Using `bombardier` (Recommended)

`bombardier` is fast enough to accurately benchmark Bun.serve. Install it:

```bash
# macOS
brew install bombardier

# Or download from https://github.com/codesenberg/bombardier/releases
```

Create three test servers:

1. **Express via node:http** (`test-express-node.ts`):
```ts
import express from "express";
const app = express();
app.get("/", (req, res) => res.json({ message: "Hello" }));
app.listen(3000);
```

2. **Express via Bun.serve shim** (`test-express-bun.ts`):
```ts
import express from "./src/js/thirdparty/express-bun";
const app = express();
app.get("/", (req, res) => res.json({ message: "Hello" }));
Bun.serve({ port: 3000, fetch: app.fetch.bind(app) });
```

3. **Pure Bun.serve** (`test-bun-serve.ts`):
```ts
Bun.serve({
  port: 3000,
  fetch: () => Response.json({ message: "Hello" }),
});
```

Run benchmarks:
```bash
# Terminal 1: Start Express via node:http
bun test-express-node.ts
# Terminal 2: Benchmark it
bombardier -n 100000 -c 100 http://localhost:3000

# Terminal 1: Start Express via Bun.serve shim
bun test-express-bun.ts
# Terminal 2: Benchmark it
bombardier -n 100000 -c 100 http://localhost:3000

# Terminal 1: Start pure Bun.serve
bun test-bun-serve.ts
# Terminal 2: Benchmark it
bombardier -n 100000 -c 100 http://localhost:3000
```

### Option 2: Using `mitata` (Microbenchmarks)

For microbenchmarks comparing request handling overhead:

```ts
import { bench, run } from "mitata";

// Setup servers (similar to above)
// Then benchmark request handling
bench("Express via node:http", async () => {
  await fetch("http://localhost:3000");
});

bench("Express via Bun.serve shim", async () => {
  await fetch("http://localhost:3001");
});

bench("Pure Bun.serve", async () => {
  await fetch("http://localhost:3002");
});

await run();
```

## What to Measure

1. **Throughput (req/s)**: How many requests per second each approach handles
2. **Latency (p50, p95, p99)**: Response time percentiles
3. **Memory usage**: Heap size and allocations
4. **CPU usage**: How efficiently each approach uses CPU

## Expected Results

If the shim is successful, you should see:
- **Express via Bun.serve shim** performing **significantly better** than Express via `node:http`
- Performance closer to pure Bun.serve (though likely not as fast due to Express API overhead)

If the shim shows **minimal or no improvement**, it suggests:
- Express API design limits optimization opportunities
- The shim may not be worth the maintenance burden
- Express via `node:http` is sufficient

## Sharing Results

Please share benchmark results in the PR discussion. This will help determine whether to:
- Continue developing the shim
- Mark it as experimental/opt-in only
- Close the PR if benchmarks don't show meaningful improvements

