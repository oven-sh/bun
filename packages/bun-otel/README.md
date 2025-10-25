# bun-otel

OpenTelemetry instrumentation for Bun runtime with native hooks.

## Installation

```bash
bun add bun-otel
```

## Quick Start

```typescript
import { BunSDK } from "bun-otel";
import { ConsoleSpanExporter } from "@opentelemetry/sdk-trace-base";

const sdk = new BunSDK({
  traceExporter: new ConsoleSpanExporter(),
  serviceName: "my-service",
});

sdk.start();

// Your Bun.serve() and fetch() calls are now automatically traced
Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response("Hello!");
  },
});
```

## What's Included

### Automatic Instrumentation

- **Bun.serve()** - HTTP server spans with request/response attributes
- **Node.js http.createServer()** - Full compatibility layer instrumentation
- **fetch()** - HTTP client spans with distributed tracing

### Configuration

Follows standard OpenTelemetry environment variables:

- `OTEL_SERVICE_NAME` - Service name (defaults to package.json name)
- `OTEL_TRACES_EXPORTER` - Trace exporter (otlp, console, none)
- `OTEL_EXPORTER_OTLP_ENDPOINT` - OTLP collector endpoint
- `OTEL_RESOURCE_ATTRIBUTES` - Additional resource attributes

Or configure programmatically:

```typescript
import { BunSDK } from "bun-otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const sdk = new BunSDK({
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4318/v1/traces",
  }),
  serviceName: "my-service",
  instrumentations: [
    // Add custom instrumentations here
  ],
});

await sdk.start();

// Cleanup when shutting down
await sdk.shutdown();
```

### Using with @opentelemetry/sdk-node

If you have existing code using `@opentelemetry/sdk-node`:

```typescript
// Before
import { NodeSDK } from "@opentelemetry/sdk-node";

// After
import { BunSDK } from "bun-otel";
```

The API is compatible - just swap the import and you're done.

## Header Capture

By default, only safe headers are captured:

- `content-type`
- `content-length`
- `user-agent`
- `accept`

To capture additional headers:

```typescript
import { BunHttpInstrumentation } from "bun-otel";

const httpInstrumentation = new BunHttpInstrumentation({
  captureAttributes: {
    requestHeaders: ["content-type", "x-request-id"],
    responseHeaders: ["content-type"],
  },
});
```

Sensitive headers (authorization, cookie, api keys) are always blocked.

## Performance

- **When disabled**: <0.1% overhead (essentially zero)
- **When enabled**: <5% latency increase for HTTP requests
- Uses native Zig hooks for minimal overhead

## API Reference

### BunSDK

```typescript
interface BunSDKConfiguration {
  // Tracing
  traceExporter?: SpanExporter;
  spanProcessor?: SpanProcessor;
  sampler?: Sampler;

  // Resource
  serviceName?: string;
  resource?: Resource;
  resourceDetectors?: ResourceDetector[];

  // Propagation
  textMapPropagator?: TextMapPropagator;

  // Instrumentation
  instrumentations?: Instrumentation[];
}

class BunSDK {
  constructor(config?: BunSDKConfiguration);
  start(): Promise<void>;
  shutdown(): Promise<void>;
}
```

### Instrumentations

```typescript
import {
  BunHttpInstrumentation,
  BunFetchInstrumentation,
  BunNodeInstrumentation,
} from "bun-otel/instrumentations";

// All instrumentations are enabled by default when using BunSDK
// Use these directly only if you need custom configuration
```

## Examples

### Jaeger

```typescript
import { BunSDK } from "bun-otel";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

const sdk = new BunSDK({
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4318/v1/traces",
  }),
});

await sdk.start();
```

### Distributed Tracing

Client:

```typescript
import { trace } from "@opentelemetry/api";

const response = await fetch("http://api.example.com/data");
// Trace context automatically propagated via traceparent header
```

Server:

```typescript
Bun.serve({
  fetch(req) {
    // Incoming traceparent header automatically extracted
    const span = trace.getActiveSpan();
    console.log("Trace ID:", span?.spanContext().traceId);
    return new Response("OK");
  },
});
```

### Manual Spans

```typescript
import { trace } from "@opentelemetry/api";

const tracer = trace.getTracer("my-app");

Bun.serve({
  async fetch(req) {
    return await tracer.startActiveSpan("process-request", async span => {
      span.setAttribute("custom.attribute", "value");

      // Your logic here
      const result = await doWork();

      span.end();
      return new Response(result);
    });
  },
});
```

## Known Limitations

- **Metrics**: Runtime metrics (memory, CPU, event loop) - not yet implemented
- **Logging**: Log correlation helpers - not yet implemented
- **Database instrumentation**: SQL, Redis, etc. - hooks provided but instrumentations not included
- **Framework support**: Hono, Elysia auto-instrumentation - not yet available

## Contributing

This package is part of the Bun runtime. See the [Bun repository](https://github.com/oven-sh/bun) for contribution guidelines.

## License

MIT
