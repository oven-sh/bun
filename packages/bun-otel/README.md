# bun-otel

OpenTelemetry SDK for Bun - built on stable 1.x packages with a NodeSDK-like API.

## Overview

OpenTelemetry has three pillars: **Traces**, **Metrics**, and **Logs**. This package currently implements **distributed tracing** for Bun HTTP servers, with metrics and logs support planned for future releases.

## Why This Package?

OpenTelemetry's autoinstrumentation doesn't work with Bun because it relies on monkey-patching Node.js's `require()` system. Bun's HTTP server is implemented in native code (Zig), so there's nothing to patch.

This package bridges Bun's native telemetry hooks to the OpenTelemetry SDK, enabling automatic distributed tracing for both `Bun.serve()` and Node.js `http.createServer()` applications.

### Architecture

**BunSDK** is built directly on stable OpenTelemetry packages (1.x):
- `@opentelemetry/sdk-trace-node` (1.30.1)
- `@opentelemetry/sdk-trace-base` (1.30.1)
- `@opentelemetry/resources` (1.30.1)
- `@opentelemetry/core` (1.30.1)

Unlike the experimental `@opentelemetry/sdk-node` (0.x), BunSDK provides a stable, production-ready API while maintaining familiar NodeSDK-like configuration.

## Installation

```bash
bun add bun-otel @opentelemetry/api
```

All required OpenTelemetry SDK packages are included as dependencies.

## Quick Start

```typescript
import { BunSDK } from 'bun-otel';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';

// Set up OpenTelemetry with BunSDK (NodeSDK-like API)
const sdk = new BunSDK({
  traceExporter: new ConsoleSpanExporter(),
  serviceName: 'my-service',
});

sdk.start();

// All HTTP requests are now automatically traced!
Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response('Hello World');
  }
});

// Optional: flush spans on shutdown
process.on('SIGINT', async () => {
  await sdk.shutdown();
  process.exit(0);
});
```

That's it! `BunSDK` automatically instruments both `Bun.serve()` and `http.createServer()` via `Bun.telemetry` hooks.

### Comparison to NodeSDK

If you're familiar with `@opentelemetry/sdk-node`, BunSDK provides an almost identical API:

```typescript
// NodeSDK (experimental 0.x)
import { NodeSDK } from '@opentelemetry/sdk-node';

const sdk = new NodeSDK({
  traceExporter: new ConsoleSpanExporter(),
  serviceName: 'my-service',
});

// BunSDK (stable 1.x packages)
import { BunSDK } from 'bun-otel';

const sdk = new BunSDK({
  traceExporter: new ConsoleSpanExporter(),
  serviceName: 'my-service',
});
```

**Key differences:**
- BunSDK is built on stable 1.x packages (not experimental 0.x)
- BunSDK automatically instruments Bun's native HTTP server
- BunSDK works with both `Bun.serve()` and `http.createServer()`

## Configuration

### Basic Configuration

```typescript
import { BunSDK } from 'bun-otel';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';

const sdk = new BunSDK({
  traceExporter: new ConsoleSpanExporter(),
  serviceName: 'my-service',
});

sdk.start();
```

### Advanced Configuration

BunSDK supports all the same configuration options as NodeSDK:

```typescript
import { BunSDK } from 'bun-otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';

const sdk = new BunSDK({
  // Exporter (OTLP, Jaeger, Zipkin, etc.)
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  }),

  // Service identification
  serviceName: 'my-production-service',

  // Custom resource attributes
  resource: new Resource({
    'deployment.environment': 'production',
    'service.version': '1.2.3',
    'service.namespace': 'my-company',
  }),

  // Auto-detect host, process, and environment resources
  autoDetectResources: true,

  // Custom sampling, propagators, etc.
  // sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.5) }),
  // textMapPropagator: new W3CTraceContextPropagator(),
});

sdk.start();
```

### Configuration Options

All BunSDK configuration options:

- `traceExporter`: Span exporter (console, OTLP, Jaeger, etc.)
- `spanProcessor`: Custom span processor (overrides traceExporter)
- `spanProcessors`: Multiple span processors for multi-destination export
- `serviceName`: Service name (convenience for resource attributes)
- `resource`: Custom resource attributes
- `resourceDetectors`: Custom resource detectors
- `autoDetectResources`: Auto-detect host/process resources (default: true)
- `sampler`: Custom sampling strategy
- `spanLimits`: Limits for attributes, events, and links
- `idGenerator`: Custom trace/span ID generator
- `contextManager`: Custom context manager
- `textMapPropagator`: Custom propagator (default: W3C TraceContext + Baggage)
- `tracerName`: Tracer name for Bun.telemetry spans (default: '@bun/otel')

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
    span.setAttribute('http.route', c.req.routePath);
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
      span.setAttribute('http.route', ctx.path);
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
