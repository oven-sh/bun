# Native Express.js shim for Bun.serve (Experimental)

Fixes #24759

## Summary

This PR implements an **experimental** native Express.js shim that works directly with `Bun.serve`, avoiding the Node.js compatibility layer. This is a proof-of-concept to explore potential performance improvements.

**⚠️ Important Considerations:**
- Express.js already works well via Bun's native `node:http` compatibility layer
- This shim may not provide meaningful performance improvements due to Express's API design
- Benchmarks are included to validate the approach
- This is experimental and may have compatibility issues
- Consider using Express via `node:http` for production use

## Changes

- **Added** `src/js/thirdparty/express-bun.ts` - Core Express shim implementation
  - Express Application class with routing support
  - Express Request/Response wrappers compatible with Bun's Request/Response
  - Router with middleware support
  - HTTP methods: GET, POST, PUT, DELETE, PATCH, ALL
  - Route parameters (`/users/:id`)
  - Basic body parsing (JSON, text, form-urlencoded)
  - Middleware chain execution
  - Settings support (case sensitive routing, strict routing)

- **Added** `test/js/third_party/express/express-bun-serve.test.ts` - Test suite
  - Basic GET route tests
  - Route with parameters
  - POST with JSON body
  - 404 handling

- **Added** `docs/guides/ecosystem/express-bun-serve.mdx` - Documentation

## Usage

```ts
import express from "express";
const app = express();

app.get("/users/:id", (req, res) => {
  res.json({ userId: req.params.id });
});

Bun.serve({
  fetch: app.fetch.bind(app),
  port: 3000,
});
```

## Status

This is an experimental proof-of-concept implementation with core Express features. Advanced features like view rendering, advanced middleware, and error handling middleware are marked as TODO for future work.

## Benchmarks

Benchmarks are included in `bench/express-bun-serve/express-benchmark.ts` to compare:
- Express via `node:http` (current approach)
- Express via Bun.serve shim (this PR)
- Pure Bun.serve (baseline)

Run with: `bun bench/express-bun-serve/express-benchmark.ts`

**Note:** Benchmarks are needed to validate whether this approach provides meaningful performance improvements. The Express API design may limit optimization opportunities.

## Testing

Tests pass with `bun bd test test/js/third_party/express/express-bun-serve.test.ts`

## Discussion

This PR is experimental. Contributors have raised valid concerns:
- Existing shims (like undici) cause compatibility issues
- Express is essentially a router for `node:http` which is already well-implemented in Bun
- Express API design is slow by modern standards and hard to optimize
- Using Bun.serve routes conflicts with Express middleware features

Benchmarks will help determine if this approach is worth pursuing.

