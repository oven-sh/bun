# Contract: BunSDK

**Feature**: OpenTelemetry Support for Bun
**Component**: High-Level SDK (TypeScript)
**Scope**: Drop-in replacement for `@opentelemetry/sdk-node`
**Audience**: Bun application developers

**Related Contracts**:
- [bun-telemetry-api.md](./bun-telemetry-api.md) - Native Zig API used by BunSDK instrumentations
- [hook-lifecycle.md](./hook-lifecycle.md) - Hook specifications and attributes

---

## Design Philosophy

**Core Principle**: BunSDK is a thin wrapper around NodeSDK that adds Bun-native instrumentations automatically.

**Key Goals**:
1. **Drop-In Replacement**: Applications using `@opentelemetry/sdk-node` can switch to BunSDK with <20 lines of code changes (success criteria SC-005)
2. **Automatic Instrumentation**: Bun.serve() and fetch() automatically instrumented when SDK starts
3. **Environment Variable Compatibility**: All OTEL_* environment variables work identically to NodeSDK
4. **Standard APIs**: Same constructor signature, lifecycle methods, and configuration options as NodeSDK

**Flow**:
```
BunSDK extends NodeSDK
  → Auto-registers BunHttpInstrumentation, BunFetchInstrumentation
  → Calls super.start()
  → Standard OpenTelemetry SDK initialization
```

---

## API Surface

### Constructor

```typescript
class BunSDK extends NodeSDK {
  constructor(configuration?: Partial<BunSDKConfiguration>)
}
```

**Parameters**: Extends NodeSDK configuration with BunSDK-specific behavior (see configuration interface below)

**Configuration Interface**:
```typescript
interface BunSDKConfiguration {
  // Resource Configuration
  autoDetectResources?: boolean;
  resource?: Resource;
  resourceDetectors?: Array<ResourceDetector>;
  serviceName?: string;

  // Context & Propagation
  contextManager?: ContextManager;
  textMapPropagator?: TextMapPropagator | null;

  // Tracing Configuration
  sampler?: Sampler;
  spanLimits?: SpanLimits;
  idGenerator?: IdGenerator;
  traceExporter?: SpanExporter;
  spanProcessors?: SpanProcessor[];

  // Metrics Configuration
  metricReaders?: IMetricReader[];
  views?: ViewOptions[];

  // Logging Configuration
  logRecordProcessors?: LogRecordProcessor[];

  // Instrumentation
  instrumentations?: (Instrumentation | Instrumentation[])[];
}
```

**Note**: Deprecated fields from NodeSDK (`spanProcessor`, `metricReader`, `logRecordProcessor`) are NOT supported in BunSDK. Use the plural forms (`spanProcessors`, `metricReaders`, `logRecordProcessors`) instead.

**Bun-Specific Behavior**:
- If `instrumentations` not provided or empty: BunSDK **auto-registers** `BunHttpInstrumentation` and `BunFetchInstrumentation`
- If `instrumentations` provided: User controls which instrumentations are registered (can exclude Bun instrumentations if desired)
- If `metricReaders` provided: BunMetricsInstrumentation automatically registered for runtime metrics

**Example (minimal)**:
```typescript
import { BunSDK } from '@bun/otel';

// Uses OTEL_* environment variables for configuration
const sdk = new BunSDK();
sdk.start();
```

**Example (custom configuration)**:
```typescript
import { BunSDK } from '@bun/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const sdk = new BunSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'my-bun-app',
  }),
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  }),
  // BunHttpInstrumentation and BunFetchInstrumentation still auto-registered
});

sdk.start();
```

**Example (custom instrumentations)**:
```typescript
import { BunSDK, BunHttpInstrumentation, BunFetchInstrumentation } from '@bun/otel';
import { MyCustomInstrumentation } from './custom';

const sdk = new BunSDK({
  instrumentations: [
    new BunHttpInstrumentation({
      captureAttributes: {
        requestHeaders: ['x-request-id', 'content-type'],
        responseHeaders: ['x-trace-id'],
      },
    }),
    new BunFetchInstrumentation(),
    new MyCustomInstrumentation(),
  ],
});

sdk.start();
```

---

### Lifecycle Methods

#### `start(): void`

**Purpose**: Initialize and register all SDK components with OpenTelemetry API

**Behavior** (extends NodeSDK.start()):
1. If `instrumentations` not provided in constructor:
   - Create `BunHttpInstrumentation` with default configuration
   - Create `BunFetchInstrumentation` with default configuration
   - If `metricReaders` configured: Create `BunMetricsInstrumentation`
2. Call `super.start()` which:
   - Registers all instrumentations (Bun + user-provided)
   - Sets up context manager and propagator
   - Detects resources (if `autoDetectResources` true)
   - Initializes TracerProvider, MeterProvider, LoggerProvider
   - Sets global providers

**Side Effects**:
- Native `Bun.telemetry.attach()` called for each Bun instrumentation
- HTTP server and fetch client instrumentation active
- Global TracerProvider, MeterProvider, LoggerProvider registered

**Throws**:
- Same errors as NodeSDK.start()
- `TypeError` if Bun.telemetry API not available (running in Node.js)

**Example**:
```typescript
const sdk = new BunSDK();
sdk.start();

// Now instrumentation is active:
Bun.serve({
  port: 3000,
  fetch(req) {
    // This request is automatically traced
    return new Response('Hello');
  },
});
```

---

#### `shutdown(): Promise<void>`

**Purpose**: Gracefully shutdown all SDK components and flush pending telemetry

**Behavior** (extends NodeSDK.shutdown()):
1. Shutdown TracerProvider (flushes pending spans)
2. Shutdown MeterProvider (flushes pending metrics)
3. Shutdown LoggerProvider (flushes pending logs)
4. Detach all Bun instrumentations (calls `Bun.telemetry.detach()`)
5. Wait for all shutdowns to complete

**Returns**: `Promise<void>` that resolves when all components shut down

**Guaranteed**: All telemetry exported before promise resolves (or export timeout reached)

**Example**:
```typescript
const sdk = new BunSDK();
sdk.start();

// Graceful shutdown on SIGTERM
process.on('SIGTERM', async () => {
  console.log('Shutting down OpenTelemetry SDK...');
  await sdk.shutdown();
  console.log('Telemetry exported successfully');
  process.exit(0);
});
```

---

## Supported Environment Variables

**Source**: [OpenTelemetry Environment Variable Specification](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/)

### General SDK Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OTEL_SDK_DISABLED` | boolean | `false` | Disable the SDK entirely (no-op mode) |
| `OTEL_LOG_LEVEL` | string | `info` | SDK internal log level: `none`, `error`, `warn`, `info`, `debug`, `verbose` |
| `OTEL_RESOURCE_ATTRIBUTES` | string | - | Resource attributes as comma-separated key=value pairs (e.g., `service.name=my-app,deployment.environment=production`) |
| `OTEL_SERVICE_NAME` | string | `unknown_service:bun` | Service name (shorthand for `service.name` resource attribute) |
| `OTEL_NODE_RESOURCE_DETECTORS` | string | `env,host,process` | Comma-separated list of resource detectors: `env`, `host`, `process`, `os`, `all`, `none` |

**Example**:
```bash
export OTEL_SERVICE_NAME="my-bun-app"
export OTEL_LOG_LEVEL="debug"
export OTEL_RESOURCE_ATTRIBUTES="deployment.environment=production,service.version=1.2.3"
```

---

### Trace Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OTEL_TRACES_EXPORTER` | string | `otlp` | Trace exporter: `otlp`, `jaeger`, `zipkin`, `console`, `none` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | string | `http://localhost:4318` | Base OTLP endpoint (appends `/v1/traces` for traces) |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | string | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` | OTLP traces-specific endpoint (overrides base endpoint) |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | string | `http/protobuf` | OTLP protocol: `grpc`, `http/protobuf`, `http/json` |
| `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL` | string | `${OTEL_EXPORTER_OTLP_PROTOCOL}` | OTLP traces-specific protocol |
| `OTEL_EXPORTER_OTLP_HEADERS` | string | - | Headers as comma-separated key=value pairs (e.g., `api-key=secret,x-custom=value`) |
| `OTEL_EXPORTER_OTLP_TRACES_HEADERS` | string | - | Traces-specific headers (merged with base headers) |
| `OTEL_EXPORTER_OTLP_TIMEOUT` | number | `10000` | Export timeout in milliseconds |
| `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT` | number | `${OTEL_EXPORTER_OTLP_TIMEOUT}` | Traces-specific timeout |
| `OTEL_TRACES_SAMPLER` | string | `parentbased_always_on` | Sampler: `always_on`, `always_off`, `traceidratio`, `parentbased_always_on`, `parentbased_always_off`, `parentbased_traceidratio` |
| `OTEL_TRACES_SAMPLER_ARG` | number | - | Sampler argument (e.g., `0.1` for 10% sampling with `traceidratio`) |
| `OTEL_SPAN_ATTRIBUTE_COUNT_LIMIT` | number | `128` | Maximum number of attributes per span |
| `OTEL_SPAN_ATTRIBUTE_VALUE_LENGTH_LIMIT` | number | - | Maximum attribute value length (unlimited if not set) |
| `OTEL_SPAN_EVENT_COUNT_LIMIT` | number | `128` | Maximum number of events per span |
| `OTEL_SPAN_LINK_COUNT_LIMIT` | number | `128` | Maximum number of links per span |
| `OTEL_BSP_SCHEDULE_DELAY` | number | `5000` | BatchSpanProcessor export interval in milliseconds |
| `OTEL_BSP_EXPORT_TIMEOUT` | number | `30000` | BatchSpanProcessor export timeout in milliseconds |
| `OTEL_BSP_MAX_QUEUE_SIZE` | number | `2048` | BatchSpanProcessor maximum queue size |
| `OTEL_BSP_MAX_EXPORT_BATCH_SIZE` | number | `512` | BatchSpanProcessor maximum batch size |

**Example**:
```bash
# OTLP over HTTP with custom headers
export OTEL_TRACES_EXPORTER="otlp"
export OTEL_EXPORTER_OTLP_ENDPOINT="https://api.honeycomb.io"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"
export OTEL_EXPORTER_OTLP_HEADERS="x-honeycomb-team=YOUR_API_KEY"

# 10% sampling with parent-based decision
export OTEL_TRACES_SAMPLER="parentbased_traceidratio"
export OTEL_TRACES_SAMPLER_ARG="0.1"
```

---

### Metrics Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OTEL_METRICS_EXPORTER` | string | `otlp` | Metrics exporter: `otlp`, `prometheus`, `console`, `none` |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | string | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/metrics` | OTLP metrics-specific endpoint |
| `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` | string | `${OTEL_EXPORTER_OTLP_PROTOCOL}` | OTLP metrics-specific protocol |
| `OTEL_EXPORTER_OTLP_METRICS_HEADERS` | string | - | Metrics-specific headers |
| `OTEL_EXPORTER_OTLP_METRICS_TIMEOUT` | number | `${OTEL_EXPORTER_OTLP_TIMEOUT}` | Metrics-specific timeout |
| `OTEL_METRIC_EXPORT_INTERVAL` | number | `60000` | Metric export interval in milliseconds |
| `OTEL_METRIC_EXPORT_TIMEOUT` | number | `30000` | Metric export timeout in milliseconds |
| `OTEL_EXPORTER_PROMETHEUS_HOST` | string | `localhost` | Prometheus exporter host |
| `OTEL_EXPORTER_PROMETHEUS_PORT` | number | `9464` | Prometheus exporter port |

**Bun-Specific Behavior**:
- If `OTEL_METRICS_EXPORTER` is set (not `none`), `BunMetricsInstrumentation` automatically registered
- Runtime metrics (memory, event loop lag, GC stats) collected and exported via configured exporter

**Example**:
```bash
# OTLP metrics with custom interval
export OTEL_METRICS_EXPORTER="otlp"
export OTEL_METRIC_EXPORT_INTERVAL="30000"  # Export every 30 seconds

# OR: Prometheus exporter
export OTEL_METRICS_EXPORTER="prometheus"
export OTEL_EXPORTER_PROMETHEUS_PORT="9090"
```

---

### Logs Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OTEL_LOGS_EXPORTER` | string | `otlp` | Logs exporter: `otlp`, `console`, `none` |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | string | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/logs` | OTLP logs-specific endpoint |
| `OTEL_EXPORTER_OTLP_LOGS_PROTOCOL` | string | `${OTEL_EXPORTER_OTLP_PROTOCOL}` | OTLP logs-specific protocol |
| `OTEL_EXPORTER_OTLP_LOGS_HEADERS` | string | - | Logs-specific headers |
| `OTEL_EXPORTER_OTLP_LOGS_TIMEOUT` | number | `${OTEL_EXPORTER_OTLP_TIMEOUT}` | Logs-specific timeout |
| `OTEL_BLRP_SCHEDULE_DELAY` | number | `1000` | BatchLogRecordProcessor export interval in milliseconds |
| `OTEL_BLRP_EXPORT_TIMEOUT` | number | `30000` | BatchLogRecordProcessor export timeout in milliseconds |
| `OTEL_BLRP_MAX_QUEUE_SIZE` | number | `2048` | BatchLogRecordProcessor maximum queue size |
| `OTEL_BLRP_MAX_EXPORT_BATCH_SIZE` | number | `512` | BatchLogRecordProcessor maximum batch size |

**Example**:
```bash
export OTEL_LOGS_EXPORTER="otlp"
export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT="http://localhost:4318/v1/logs"
```

---

### Propagator Configuration

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `OTEL_PROPAGATORS` | string | `tracecontext,baggage` | Comma-separated list of propagators: `tracecontext`, `baggage`, `b3`, `b3multi`, `jaeger`, `ottrace`, `xray` |

**Example**:
```bash
# W3C TraceContext + Baggage (default)
export OTEL_PROPAGATORS="tracecontext,baggage"

# B3 multi-header format (Zipkin)
export OTEL_PROPAGATORS="b3multi"

# Multiple propagators
export OTEL_PROPAGATORS="tracecontext,baggage,b3"
```

---

## Auto-Registered Instrumentations

### BunHttpInstrumentation

**Activated When**: BunSDK.start() called and `instrumentations` not manually provided

**Purpose**: Automatic instrumentation for `Bun.serve()` HTTP servers

**Default Configuration**:
```typescript
new BunHttpInstrumentation({
  captureAttributes: {
    requestHeaders: ['content-type', 'content-length', 'user-agent', 'accept'],
    responseHeaders: ['content-type', 'content-length'],
  },
})
```

**Span Attributes** (per [hook-lifecycle.md](./hook-lifecycle.md#standard-http-server-attributes-opentelemetry-v1230)):
- `http.request.method` (GET, POST, etc.)
- `url.path` (/api/users)
- `url.query` (limit=10)
- `http.response.status_code` (200, 404, 500)
- `server.address`, `server.port`
- `http.request.header.*` (configured headers only)
- `http.response.header.*` (configured headers only)

**Manual Configuration** (override defaults):
```typescript
import { BunSDK, BunHttpInstrumentation } from '@bun/otel';

const sdk = new BunSDK({
  instrumentations: [
    new BunHttpInstrumentation({
      captureAttributes: {
        requestHeaders: ['x-request-id', 'content-type'],
        responseHeaders: ['x-trace-id'],
      },
    }),
  ],
});
```

---

### BunFetchInstrumentation

**Activated When**: BunSDK.start() called and `instrumentations` not manually provided

**Purpose**: Automatic instrumentation for `fetch()` HTTP client requests

**Default Configuration**:
```typescript
new BunFetchInstrumentation({
  captureAttributes: {
    requestHeaders: ['content-type'],
    responseHeaders: ['content-type'],
  },
})
```

**Span Attributes** (per [hook-lifecycle.md](./hook-lifecycle.md#standard-fetch-client-attributes)):
- `http.request.method` (GET, POST, etc.)
- `url.full` (https://api.example.com/data)
- `http.response.status_code` (200, 404, 500)
- `server.address`, `server.port`
- `http.request.header.*` (configured headers only)
- `http.response.header.*` (configured headers only)

**Trace Context Propagation**:
- Automatically injects `traceparent` header (W3C TraceContext) into outbound requests
- Supports B3, Jaeger propagators via `OTEL_PROPAGATORS` environment variable

---

### BunMetricsInstrumentation

**Activated When**: `metricReaders` provided in configuration OR `OTEL_METRICS_EXPORTER` environment variable set

**Purpose**: Runtime metrics collection for Bun process health

**Metrics Collected**:
1. **HTTP Server Metrics**:
   - `http.server.request.count` (Counter) - Total HTTP requests
   - `http.server.request.duration` (Histogram) - Request duration in milliseconds
   - `http.server.active_requests` (UpDownCounter) - Currently in-flight requests

2. **HTTP Client Metrics**:
   - `http.client.request.count` (Counter) - Total fetch requests
   - `http.client.request.duration` (Histogram) - Request duration in milliseconds

3. **Runtime Metrics** (namespace auto-detected based on `process.release.name`):
   - `process.runtime.bun.memory.heap_used` (Gauge) - Heap memory used in bytes
   - `process.runtime.bun.memory.rss` (Gauge) - Resident set size in bytes
   - `process.runtime.bun.event_loop.lag` (Gauge) - Event loop lag in milliseconds
   - `process.runtime.bun.gc.duration` (Histogram) - GC pause times in milliseconds
   - `process.runtime.bun.gc.count` (Counter) - GC execution count

**Namespace Fallback**: If running in Node.js compatibility mode, uses `process.runtime.nodejs.*` prefix

**Configuration**:
```typescript
import { BunSDK } from '@bun/otel';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

const sdk = new BunSDK({
  metricReaders: [
    new PrometheusExporter({ port: 9464 }),
  ],
});

// BunMetricsInstrumentation automatically registered
sdk.start();
```

---

## Differences from NodeSDK

### 1. Auto-Instrumentation Behavior

**NodeSDK**:
- Requires manual instrumentation registration via `instrumentations` option
- No automatic HTTP/fetch instrumentation

**BunSDK**:
- Auto-registers `BunHttpInstrumentation`, `BunFetchInstrumentation` if `instrumentations` not provided
- Users can override by providing custom `instrumentations` array

---

### 2. Native Hook Implementation

**NodeSDK**:
- Uses monkey-patching via `require-in-the-middle` for instrumentation
- ~15-20% performance overhead

**BunSDK**:
- Uses native Zig hooks (`Bun.telemetry.attach()`) for zero-overhead instrumentation
- ~4-5% performance overhead when enabled, <0.1% when disabled

---

### 3. Runtime Metrics

**NodeSDK**:
- No built-in runtime metrics
- Requires separate `@opentelemetry/host-metrics` package

**BunSDK**:
- Built-in runtime metrics via `BunMetricsInstrumentation`
- Automatically enabled when `metricReaders` configured

---

### 4. Context Propagation

**NodeSDK**:
- Uses `AsyncLocalStorage` from Node.js with full `context.with()` support

**BunSDK**:
- Uses Bun's `AsyncLocalStorage` implementation
- Workarounds applied via `BunAsyncLocalStorageContextManager` (see research.md Decision 4)
- Zig layer creates AsyncLocalStorage stack frame before calling request handlers

---

## Migration from NodeSDK

**Before (Node.js)**:
```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

const sdk = new NodeSDK({
  traceExporter: new ConsoleSpanExporter(),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

**After (Bun)** - 2 lines changed:
```typescript
import { BunSDK } from '@bun/otel';  // Changed
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base';  // Changed
// getNodeAutoInstrumentations removed - Bun auto-instruments HTTP/Fetch

const sdk = new BunSDK({
  traceExporter: new ConsoleSpanExporter(),
  // instrumentations optional - BunHttpInstrumentation, BunFetchInstrumentation auto-registered
});

sdk.start();
```

**Migration Checklist**:
1. ✅ Change import: `@opentelemetry/sdk-node` → `@bun/otel`
2. ✅ Change class: `NodeSDK` → `BunSDK`
3. ✅ Change exporter import: `sdk-trace-node` → `sdk-trace-base`
4. ✅ Remove `getNodeAutoInstrumentations()` (Bun auto-instruments)
5. ✅ Verify environment variables still work (100% compatible)
6. ✅ Test application (should work identically)

**Total Changes**: <20 lines (success criteria SC-005 ✅)

---

## Example Configurations

### 1. Minimal Setup (Environment Variables Only)

```typescript
import { BunSDK } from '@bun/otel';

const sdk = new BunSDK();
sdk.start();

process.on('SIGTERM', async () => {
  await sdk.shutdown();
  process.exit(0);
});
```

```bash
export OTEL_SERVICE_NAME="my-bun-app"
export OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
```

---

### 2. Programmatic Configuration (Traces + Metrics + Logs)

```typescript
import { BunSDK } from '@bun/otel';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

const resource = new Resource({
  [ATTR_SERVICE_NAME]: 'my-bun-app',
  'service.version': '1.0.0',
  'deployment.environment': 'production',
});

const sdk = new BunSDK({
  resource,

  // Traces
  spanProcessors: [
    new BatchSpanProcessor(new OTLPTraceExporter({
      url: 'http://localhost:4318/v1/traces',
    }), {
      maxQueueSize: 2048,
      maxExportBatchSize: 512,
      scheduledDelayMillis: 5000,
    }),
  ],

  // Metrics
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: 'http://localhost:4318/v1/metrics',
      }),
      exportIntervalMillis: 60000,
    }),
  ],

  // Auto-registered: BunHttpInstrumentation, BunFetchInstrumentation, BunMetricsInstrumentation
});

sdk.start();
```

---

### 3. Custom Instrumentation Configuration

```typescript
import { BunSDK, BunHttpInstrumentation, BunFetchInstrumentation } from '@bun/otel';

const sdk = new BunSDK({
  instrumentations: [
    new BunHttpInstrumentation({
      captureAttributes: {
        requestHeaders: [
          'content-type',
          'x-request-id',
          'x-correlation-id',
          'user-agent',
        ],
        responseHeaders: [
          'content-type',
          'x-trace-id',
        ],
      },
    }),
    new BunFetchInstrumentation({
      captureAttributes: {
        requestHeaders: ['content-type', 'authorization'],
        responseHeaders: ['content-type'],
      },
    }),
  ],
});

sdk.start();
```

---

### 4. Production Configuration with Sampling

```typescript
import { BunSDK } from '@bun/otel';
import { ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';

const sdk = new BunSDK({
  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(0.1), // 10% sampling
  }),
});

sdk.start();
```

Or via environment variables:
```bash
export OTEL_TRACES_SAMPLER="parentbased_traceidratio"
export OTEL_TRACES_SAMPLER_ARG="0.1"
```

---

## Error Handling

### SDK Disabled

```typescript
const sdk = new BunSDK();
sdk.start(); // No-op if OTEL_SDK_DISABLED=true
```

**Behavior**:
- `start()` returns immediately
- No instrumentation registered
- No telemetry collected
- Application runs normally

---

### Missing Native API

```typescript
// Running in Node.js instead of Bun
const sdk = new BunSDK();
sdk.start(); // Throws TypeError
```

**Error**:
```
TypeError: Bun.telemetry is not defined
This package requires Bun runtime. Install from https://bun.sh
```

**Workaround**: Check runtime before initialization
```typescript
if (typeof Bun !== 'undefined' && Bun.telemetry) {
  const sdk = new BunSDK();
  sdk.start();
} else {
  console.warn('Bun.telemetry not available, skipping instrumentation');
}
```

---

### Exporter Failure

**Scenario**: OTLP exporter can't reach backend

**Behavior**:
- Spans buffered in BatchSpanProcessor queue
- Retry with exponential backoff (3 attempts per FR-017)
- After retry exhaustion, spans dropped
- Application continues normally
- Warning logged to stderr

**Log Output**:
```
[OpenTelemetry] Export failed after 3 retries. Dropping 512 spans.
```

---

## Testing

### Unit Tests

**Location**: `packages/bun-otel/test/BunSDK.test.ts`

**Test Cases**:
1. Constructor accepts same options as NodeSDK
2. Auto-registers BunHttpInstrumentation when instrumentations not provided
3. Auto-registers BunFetchInstrumentation when instrumentations not provided
4. Auto-registers BunMetricsInstrumentation when metricReaders provided
5. Respects custom instrumentations array (no auto-registration)
6. start() calls Bun.telemetry.attach() for each Bun instrumentation
7. shutdown() calls Bun.telemetry.detach() for each Bun instrumentation
8. Environment variables override constructor options
9. OTEL_SDK_DISABLED disables all functionality
10. Missing Bun.telemetry throws helpful error

**Example**:
```typescript
import { test, expect } from 'bun:test';
import { BunSDK } from '@bun/otel';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';

test('BunSDK auto-registers HTTP and Fetch instrumentations', () => {
  const exporter = new InMemorySpanExporter();
  const sdk = new BunSDK({ traceExporter: exporter });

  sdk.start();

  // Verify Bun instrumentations registered
  expect(Bun.telemetry.isEnabledFor(InstrumentKind.HTTP)).toBe(true);
  expect(Bun.telemetry.isEnabledFor(InstrumentKind.Fetch)).toBe(true);

  sdk.shutdown();
});
```

---

## Performance Characteristics

### Overhead

**Target** (per plan.md):
- <0.1% when disabled (OTEL_SDK_DISABLED=true or no metricReaders/spanProcessors)
- <5% when enabled with tracing
- <10% when enabled with tracing + metrics

**Measured** (from POC in quickstart.md):
- Disabled: <0.1% ✅ (unmeasurable)
- Enabled (console exporter): ~4.5% ✅
- Enabled (OTLP exporter): ~8-10% ✅

**Comparison to NodeSDK**:
- NodeSDK (monkey-patching): ~15-20% overhead
- BunSDK (native hooks): ~4-5% overhead
- **3-4x performance improvement** ✅

---

## Security

### Header Capture Security

**Default Behavior**: Safe headers only (per [hook-lifecycle.md#header-capture-security](./hook-lifecycle.md#header-capture-security))

**Blocked Headers** (always, never captured):
- `authorization`, `proxy-authorization`
- `cookie`, `set-cookie`
- `api-key`, `x-api-key`
- `api-token`, `x-auth-token`
- `x-csrf-token`
- `session-id`, `session-token`

**Enforcement**: Zig layer enforces blocklist, TypeScript cannot override

---

## References

- **NodeSDK Source**: [opentelemetry-js/experimental/packages/opentelemetry-sdk-node](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-sdk-node)
- **Configuration Model**: [opentelemetry-js/experimental/packages/opentelemetry-configuration](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-configuration)
- **Environment Variables Spec**: [OpenTelemetry Specification](https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/)
- **Semantic Conventions**: [OpenTelemetry Semantic Conventions v1.23.0+](https://opentelemetry.io/docs/specs/semconv/)

---

## Future Enhancements

### Planned (Not in MVP)

1. **Configuration File Support**:
   ```typescript
   const sdk = new BunSDK({
     configFile: '.otel-config.yaml',
   });
   ```

2. **Automatic SQL Instrumentation**:
   - `BunSqlInstrumentation` for `bun:sqlite`
   - Auto-registered when SQL operations detected

3. **Automatic AWS SDK Instrumentation**:
   - `BunS3Instrumentation` for S3 operations
   - Hooks already provided in Zig layer (InstrumentKind.S3)

4. **Custom Resource Detectors**:
   ```typescript
   const sdk = new BunSDK({
     resourceDetectors: [bunVersionDetector, containerDetector],
   });
   ```

5. **Framework-Specific Instrumentations**:
   - `HonoInstrumentation`, `ElysiaInstrumentation`
   - Provided as separate packages
