# bun-otel

OpenTelemetry bridge for Bun's native telemetry system.

## Overview

OpenTelemetry has three pillars: **Traces**, **Metrics**, and **Logs**. This package currently implements **distributed tracing** for Bun HTTP servers, with metrics and logs support planned for future releases.

## Why This Package?

OpenTelemetry's autoinstrumentation doesn't work with Bun because it relies on monkey-patching Node.js's `require()` system. Bun's HTTP server is implemented in native code (Zig), so there's nothing to patch.

This package bridges Bun's native telemetry hooks to the OpenTelemetry SDK, enabling automatic distributed tracing for both `Bun.serve()` and Node.js `http.createServer()` applications.

## Installation

```bash
bun add bun-otel @opentelemetry/api @opentelemetry/sdk-trace-node
```

## Quick Start

```typescript
import { BunSDK } from 'bun-otel';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

// Set up OpenTelemetry
const provider = new NodeTracerProvider();
provider.addSpanProcessor(new SimpleSpanProcessor(new ConsoleSpanExporter()));
provider.register();

// Start Bun instrumentation
const sdk = new BunSDK({
  tracerProvider: provider,
});

sdk.start();

// All HTTP requests are now automatically traced!
Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response('Hello World');
  }
});
```

That's it! `BunSDK` automatically instruments both `Bun.serve()` and `http.createServer()` via `Bun.telemetry` hooks.

## Features

### Tracing (Current)
- ✅ Automatic span creation for all HTTP requests
- ✅ Works with both `Bun.serve()` and `http.createServer()`
- ✅ W3C TraceContext propagation (traceparent headers)
- ✅ HTTP semantic conventions (method, url, status, etc.)
- ✅ Error recording with stack traces
- ✅ Works with all OpenTelemetry exporters
- ✅ Compatible with Hono, Elysia, and other frameworks
- ✅ ~10x faster than traditional monkey-patching

### Future Support
- 🔮 Metrics - Performance metrics and custom measurements
- 🔮 Logs - Structured logging with trace correlation

## Framework Integration

### Hono

```typescript
import { Hono } from 'hono';
import { trace } from '@opentelemetry/api';

const app = new Hono();

app.use('*', async (c, next) => {
  const span = trace.getActiveSpan();
  if (span) {
    span.setAttribute('route', c.req.routePath);
  }
  await next();
});

Bun.serve({ fetch: app.fetch });
```

### Elysia

```typescript
import { Elysia } from 'elysia';
import { trace } from '@opentelemetry/api';

const app = new Elysia()
  .onRequest((ctx) => {
    const span = trace.getActiveSpan();
    if (span) {
      span.setAttribute('route', ctx.path);
    }
  });

Bun.serve({ fetch: app.fetch });
```

## How It Works

1. Bun's native server calls `Bun.telemetry` hooks on each request
2. This package creates OpenTelemetry spans from those hooks
3. Trace context is propagated to downstream services
4. Spans are exported to your collector (Jaeger, DataDog, etc.)

See [OTEL_INTEGRATION_STRATEGY.md](../../OTEL_INTEGRATION_STRATEGY.md) for technical details.

## Roadmap

- **v0.1** - Distributed tracing for HTTP servers (current)
- **v0.2** - Metrics support (planned)
- **v0.3** - Logs support with trace correlation (planned)

Following OpenTelemetry's modular design, all three pillars will be supported in a single package, similar to `@opentelemetry/api`.

## Related Issue

Fixes [#3775](https://github.com/oven-sh/bun/issues/3775)
