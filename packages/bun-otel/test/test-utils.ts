/**
 * Test utilities for bun-otel tests
 */
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  type ResourceMetrics,
} from "@opentelemetry/sdk-metrics";
import { InMemorySpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { expect } from "bun:test";
import { BunSDK, type BunSDK2Config } from "../src/BunSDK";
import { NativeHooks } from "../types";
import { EchoServer } from "./echo-server";

/**
 * Ref-counted EchoServer reference for tests.
 * Provides fast uninstrumented fetch without spawning Bun processes.
 */
interface EchoServerRef extends Disposable {
  fetch(url: string, init?: RequestInit): Promise<Response>;
  echoUrlObj(path?: string): URL;
  echoUrlStr(path?: string): string;
  server: EchoServer;
  port: number;
}

// Global shared EchoServer instance
let globalEchoServer: EchoServer | null = null;
let inFlight = 0;
let zeroCrossingId = 0;
let totalEchoServersCreated = 0;

// Diagnostics: warn if too many servers created (indicates ref-counting failure)
process.on("SIGTERM", () => {
  if (totalEchoServersCreated > 5) {
    console.warn(
      `⚠️  Created ${totalEchoServersCreated} EchoServers during test run (expected 1-2). Check for missing 'await using' or ref-counting issues.`,
    );
  }
});

/**
 * Make sure that your test can use an EchoServer for uninstrumented requests.
 *
 * @example
 * ```ts
 * describe("my suite", () => {
 *   beforeAll( beforeUsingEchoServer );
 *   afterAll( afterUsingEchoServer );
 *   test("test1", async () => {
 *     await makeUninstrumentedRequest("http://localhost:3000/test");
 *   });
 * });
 * ```
 */
export const beforeUsingEchoServer = refCountUp;
export const afterUsingEchoServer = refCountDown;
/**
 * Get a ref-counted EchoServer reference.
 *
 * The returned reference provides fast uninstrumented fetch via socket connection (~0.3ms)
 * instead of spawning Bun processes (~130ms). The server is lazily started on first use
 * and automatically shared across all tests.
 *
 * @example
 * ```ts
 * await using echoServer = await getEchoServer();
 * const response = await echoServer.fetch("http://localhost:3000/test");
 * // Auto-disposes at end of scope, triggering ref-count decrement
 * ```
 */
export async function getEchoServer(): Promise<EchoServerRef> {
  // Create or reuse global EchoServer (lazy start)
  if (!globalEchoServer) {
    globalEchoServer = new EchoServer();
    await globalEchoServer.start();
    totalEchoServersCreated++;
  }

  const server = globalEchoServer;
  return {
    server,
    port: server.portNumber,
    echoUrlStr(path: string = "/"): string {
      return server.getUrl(path);
    },
    echoUrlObj(path: string = "/"): URL {
      return new URL(server.getUrl(path));
    },
    fetch: (url: string, init?: RequestInit) => server.fetch(url, init),
    ...refCountUp(),
  };
}

function refCountUp(): Disposable {
  inFlight++;
  return {
    [Symbol.dispose]() {
      if (--inFlight === 0) {
        const z = ++zeroCrossingId;
        setTimeout(() => {
          // Shutdown after 500ms of inactivity
          if (z === zeroCrossingId && inFlight === 0 && globalEchoServer) {
            globalEchoServer.fireAndForgetStop();
            globalEchoServer = null;
            zeroCrossingId = inFlight = 0;
          }
        }, 500);
      }
    },
  };
}

function refCountDown(): void {
  if (--inFlight === 0 && globalEchoServer) {
    const z = ++zeroCrossingId;
    setTimeout(() => {
      // Shutdown after 500ms of inactivity
      if (z === zeroCrossingId && inFlight === 0 && globalEchoServer) {
        globalEchoServer.fireAndForgetStop();
        globalEchoServer = null;
        zeroCrossingId = inFlight = 0;
      }
    }, 500);
  }
}

/**
 * TestSDK extends BunSDK2 with helper methods for tests
 * Autostarts, is Disposable, and includes waitForSpans()
 */
export class TestSDK extends BunSDK implements AsyncDisposable, Disposable {
  readonly spanExporter: InMemorySpanExporter;
  readonly metricExporter: InMemoryMetricExporter;

  constructor(config: BunSDK2Config = {}) {
    // Create exporters automatically
    const spanExporter = new InMemorySpanExporter();
    const metricExporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);

    super({
      ...config,
      spanExporter,
      metricReaders: [
        ...(config.metricReaders || []),
        new PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: 100,
        }),
      ],
      autoStart: true,
    });

    this.spanExporter = spanExporter;
    this.metricExporter = metricExporter;
  }

  // /**
  //  * Get spans from InMemory exporter (testing only)
  //  */
  // getSpans(): ReadableSpan[] {
  //   // Try to extract spans from span processor
  //   if (this._tracerProvider) {
  //     const activeProcessor = (this._tracerProvider as any)._activeSpanProcessor;
  //     if (activeProcessor && typeof activeProcessor.forceFlush === "function") {
  //       // Check if it's a SimpleSpanProcessor with InMemorySpanExporter
  //       const exporter = (activeProcessor as InMemorySpanExporter)._exporter;
  //       if (exporter && typeof exporter.getFinishedSpans === "function") {
  //         return exporter.getFinishedSpans();
  //       }
  //     }
  //   }
  //   return [];
  // }

  waitForSpans(
    expectedCount: number,
    timeout: number | { timeoutMs: number; pollIntervalMs?: number } = 500,
    options?: { traceId?: string } | ((spans: SpanAssertHelper) => ReadableSpan[]),
  ): Promise<SpanAssertHelper> {
    return waitForSpans(this.spanExporter, expectedCount, timeout, options);
  }

  /**
   * Wait for metrics to be exported and return them
   *
   * @param clear - Clear metrics after retrieving (default: false)
   * @returns ResourceMetrics array
   */
  async waitForMetrics(clear = false): Promise<ResourceMetrics[]> {
    // Force flush all metric readers
    await this._meterProvider?.forceFlush();

    const metrics = this.metricExporter.getMetrics();

    if (clear) {
      this.metricExporter.reset();
    }

    return metrics;
  }

  shutdown(): Promise<void> {
    throw new Error("TestSDK should not be shutdown manually; use 'using' or 'await using' to auto-manage lifecycle");
  }
  [Symbol.dispose](): void | Promise<void> {
    return super.stop();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return super.stop();
  }
}

export type SpanAssertHelper = ReadableSpan[] & {
  client(): SpanAssertHelper;
  server(): SpanAssertHelper;
  withName(name: string): SpanAssertHelper;
  withTraceId(traceId: string): SpanAssertHelper;
  withSpanId(spanId: string): SpanAssertHelper;
  withParentSpanId(parentSpanId: string): SpanAssertHelper;
  withStatusCode(statusCode: number): SpanAssertHelper;
  allOf(...filters: SpanAssertFilter[]): SpanAssertHelper;
};
export type SpanAssertFilter = (s: SpanAssertHelper) => ReadableSpan[];
/**
 * Wait for exported spans with polling instead of fixed sleep.
 * Avoids timing-dependent test flakes in CI.
 *
 * @param exporter - The InMemorySpanExporter to poll
 * @param expectedCount - Number of spans to wait for
 * @param timeoutMs - Maximum time to wait (default: 500ms)
 * @throws Error if timeout is reached before expected spans are exported
 *
 * @example
 * ```ts
 * const exporter = new InMemorySpanExporter();
 * // ... make requests ...
 * await waitForSpans(exporter, 1);
 * const spans = exporter.getFinishedSpans();
 * expect(spans[0].name).toBe("GET /");
 * ```
 */
export async function waitForSpans(
  exporter: InMemorySpanExporter,
  expectedCount: number,
  timeout: number | { timeoutMs: number; pollIntervalMs?: number } = 500,
  options?: { traceId?: string } | ((spans: SpanAssertHelper) => ReadableSpan[]),
): Promise<SpanAssertHelper> {
  const startTime = Date.now();
  const timeoutMs = Math.min(typeof timeout === "number" ? timeout : timeout.timeoutMs, 500);
  const pollInterval = (typeof timeout === "object" ? timeout.pollIntervalMs : undefined) ?? 5;
  const filterFn =
    typeof options === "function"
      ? (spans: ReadableSpan[]) => {
          inAssertMode--;
          try {
            return options(makeSpanAssertHelper(spans, spans, "waitForSpans filter n=" + expectedCount));
          } finally {
            inAssertMode++;
          }
        }
      : options?.traceId
        ? (spans: ReadableSpan[]) => spans.filter(s => s.spanContext().traceId === options.traceId)
        : (spans: ReadableSpan[]) => spans;

  while (Date.now() - startTime < timeoutMs) {
    const spans = exporter.getFinishedSpans();

    // If traceId filter is provided, only count spans with matching traceId
    const matchingSpans = filterFn(spans);

    if (matchingSpans.length >= expectedCount) {
      return makeSpanAssertHelper(spans, matchingSpans); // Success
    }
    await Bun.sleep(pollInterval);
  }

  // Timeout - fail with helpful message
  const spans = exporter.getFinishedSpans();
  inAssertMode++; // enable assert mode for detailed output
  try {
    const matchingSpans = filterFn(spans);
    if (spans.length) printSpans(exporter);
    const traceIdInfo = options && typeof options !== "function" && options.traceId;
    throw new Error(
      `Timeout waiting for spans. Expected: ${expectedCount}, Found: ${matchingSpans.length}` +
        (traceIdInfo
          ? ` with traceId ${traceIdInfo} (I do have ${spans.length} spans with traceIds [${[...new Set(spans.map(s => s.spanContext().traceId))].join(", ")}])`
          : ""),
    );
  } finally {
    inAssertMode--; // back to 1
  }
}
// decrements to 0 to disable (while filtering) increments to 2 to allow decrement to still throw while displaying
let inAssertMode = 1;
function makeSpanAssertHelper(
  original: ReadableSpan[],
  spans: ReadableSpan[],
  message = "Some Span",
): SpanAssertHelper {
  const helper = spans as SpanAssertHelper;
  if (inAssertMode > 0 && spans.length === 0 && original.length > 0) {
    console.warn(`${message} found 0 spans (from ${original.length}):\n${fmtSpans(original).join("\n")}`);
    throw new Error(`${message} found 0 matching spans: ${message}`);
  }

  helper.allOf = function (...filters: SpanAssertFilter[]) {
    let filteredSpans: ReadableSpan[] = original;
    for (const filter of filters) {
      filteredSpans.push(...filter(makeSpanAssertHelper(original, filteredSpans, message + ".allOf()")));
    }
    return makeSpanAssertHelper(spans, filteredSpans, message + ".allOf()");
  };

  helper.client = function () {
    return makeSpanAssertHelper(
      spans,
      helper.filter(s => s.kind === SpanKind.CLIENT),
      message + ".client()",
    );
  };

  helper.server = function () {
    return makeSpanAssertHelper(
      spans,
      helper.filter(s => s.kind === SpanKind.SERVER),
      message + ".server()",
    );
  };

  helper.withName = function (name: string) {
    return makeSpanAssertHelper(
      spans,
      helper.filter(s => s.name === name),
      `${message}.withName(${name})`,
    );
  };

  helper.withTraceId = function (traceId: string) {
    return makeSpanAssertHelper(
      spans,
      helper.filter(s => s.spanContext().traceId === traceId),
      `${message}.withTraceId(${traceId})`,
    );
  };

  helper.withSpanId = function (spanId: string) {
    return makeSpanAssertHelper(
      spans,
      helper.filter(s => s.spanContext().spanId === spanId),
      `${message}.withSpanId(${spanId})`,
    );
  };

  helper.withParentSpanId = function (parentSpanId: string) {
    return makeSpanAssertHelper(
      spans,
      helper.filter(s => s.parentSpanContext?.spanId === parentSpanId),
      `${message}.withParentSpanId(${parentSpanId})`,
    );
  };

  helper.withStatusCode = function (statusCode: number) {
    return makeSpanAssertHelper(
      spans,
      helper.filter(s => s.status.code === statusCode),
      `${message}.withStatusCode(${statusCode})`,
    );
  };

  return helper;
}

export function printSpans(exporter: InMemorySpanExporter): void {
  fmtSpans(exporter.getFinishedSpans()).forEach(msg => console.log(msg));
}
export function fmtSpans(spans: ReadableSpan[]): string[] {
  console.log(`Exported ${spans.length} spans:`);
  return spans.map(
    span =>
      `- (K${span.kind}) ${span.name}: TraceId: ${span.spanContext().traceId}, SpanId: ${span.spanContext().spanId}, ParentSpanId: ${span.parentSpanContext?.spanId}, Status: ${span.status.code}`,
  );
}

// Test helper: make HTTP request without instrumentation (uses curl)
// export async function makeUninstrumentedRequestWithCurl(
//   url: string,
//   headers: Record<string, string> = {},
// ): Promise<string> {
//   const headerFlags = Object.entries(headers).flatMap(([key, value]) => ["-H", `${key}: ${value}`]);
//   return await $`curl -s ${headerFlags} ${url}`.text();
// }

/**
 * Make an uninstrumented HTTP request to avoid creating spans in tests.
 *
 * Uses fast socket-based fetch via ref-counted EchoServer (~0.3ms).
 * Requires `using _ = maybeMakingUninstrumentedRequests();` at the top of describe() block.
 *
 * @param url - The URL to fetch
 * @param headers - Optional headers to include
 * @throws Error if maybeMakingUninstrumentedRequests() was not called
 */
export async function makeUninstrumentedRequest(url: string, headers: Record<string, string> = {}): Promise<string> {
  // Check if maybeMakingUninstrumentedRequests() was called
  if (inFlight === 0) {
    throw new Error(
      "makeUninstrumentedRequest() requires a ref count > 0. " +
        "Place a `using _ = maybeMakingUninstrumentedRequests();` at the top of your describe() block.",
    );
  }

  // Use fast socket-based fetch via ref-counted EchoServer
  await using echo = await getEchoServer();
  const response = await echo.fetch(url, { headers });
  return await response.text();
}

// Ensure native hooks are installed by attaching a dummy instrumentation if needed

let installedDummyInstrument = false;
export function getNativeHooks(): NativeHooks {
  if (!installedDummyInstrument) {
    // Install a dummy instrumentation to ensure native hooks are available
    Bun.telemetry.attach({
      type: "custom",
      name: "dummy-instrumentation",
      version: "1.0.0",
      onOperationStart() {},
      onOperationInject() {
        return [];
      },
    });
    installedDummyInstrument = true;
  }

  const nativeHooks = (Bun.telemetry as any).nativeHooks() as NativeHooks;
  return nativeHooks;
}

// TypeScript declarations for custom matchers
declare module "bun:test" {
  interface Matchers<T = unknown> {
    toHaveAttributes(expected: Record<string, any>): T;
    toHaveAttribute(key: string, value?: any): T;
    toHaveSpanKind(expected: SpanKind): T;
    toHaveSpanName(expected: string): T;
    toHaveStatusCode(expected: SpanStatusCode): T;
    toHaveParentSpanId(expected: string): T;
  }
}
// Custom matchers for OpenTelemetry spans
expect.extend({
  toHaveAttributes(received: ReadableSpan, expected: Record<string, any>) {
    const { attributes } = received;
    const missingKeys: string[] = [];
    const mismatchedValues: Array<{ key: string; expected: any; actual: any }> = [];

    for (const [key, value] of Object.entries(expected)) {
      if (!(key in attributes)) {
        missingKeys.push(key);
      } else if (attributes[key] !== value) {
        mismatchedValues.push({ key, expected: value, actual: attributes[key] });
      }
    }

    const pass = missingKeys.length === 0 && mismatchedValues.length === 0;

    return {
      pass,
      message: () => {
        if (pass) {
          return `Expected span not to have attributes ${JSON.stringify(expected)}`;
        }
        let msg = `Expected span to have attributes:\n`;
        if (missingKeys.length > 0) {
          msg += `  Missing keys: ${missingKeys.join(", ")}\n`;
        }
        if (mismatchedValues.length > 0) {
          msg += `  Mismatched values:\n`;
          for (const { key, expected, actual } of mismatchedValues) {
            msg += `    ${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}\n`;
          }
        }
        msg += `\n  Actual attributes: ${JSON.stringify(attributes)}`;
        return msg;
      },
    };
  },

  toHaveAttribute(received: ReadableSpan, key: string, value?: any) {
    const { attributes } = received;
    const hasKey = key in attributes;
    const pass = value !== undefined ? hasKey && attributes[key] === value : hasKey;

    return {
      pass,
      message: () => {
        if (value !== undefined) {
          return pass
            ? `Expected span not to have attribute "${key}" with value ${JSON.stringify(value)}`
            : `Expected span to have attribute "${key}" with value ${JSON.stringify(value)}, got ${JSON.stringify(attributes[key])}`;
        }
        return pass
          ? `Expected span not to have attribute "${key}"`
          : `Expected span to have attribute "${key}". Available: ${Object.keys(attributes).join(", ")}`;
      },
    };
  },

  toHaveSpanKind(received: ReadableSpan, expected: SpanKind) {
    const pass = received.kind === expected;
    return {
      pass,
      message: () =>
        pass
          ? `Expected span not to have kind ${SpanKind[expected]}`
          : `Expected span to have kind ${SpanKind[expected]}, got ${SpanKind[received.kind]}`,
    };
  },

  toHaveSpanName(received: ReadableSpan, expected: string) {
    const pass = received.name === expected;
    return {
      pass,
      message: () =>
        pass
          ? `Expected span not to have name "${expected}"`
          : `Expected span to have name "${expected}", got "${received.name}"`,
    };
  },

  toHaveStatusCode(received: ReadableSpan, expected: SpanStatusCode) {
    const pass = received.status.code === expected;
    return {
      pass,
      message: () =>
        pass
          ? `Expected span not to have status code ${SpanStatusCode[expected]}`
          : `Expected span to have status code ${SpanStatusCode[expected]}, got ${SpanStatusCode[received.status.code]}`,
    };
  },

  toHaveParentSpanId(received: ReadableSpan, expected: string) {
    const actual = received.parentSpanContext?.spanId;
    const pass = actual === expected;
    return {
      pass,
      message: () =>
        pass
          ? `Expected span not to have parent span ID "${expected}"`
          : `Expected span to have parent span ID "${expected}", got "${actual}"`,
    };
  },
} as any);
