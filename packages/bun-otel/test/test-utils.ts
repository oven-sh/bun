/**
 * Test utilities for bun-otel tests
 */
import type { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { $ } from "bun";
import { NativeHooks } from "../types";

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
  timeoutMs = 500,
  options?: { traceId?: string; pollIntervalMs?: number },
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = options?.pollIntervalMs ?? 5; // Poll every 5ms by default

  while (Date.now() - startTime < timeoutMs) {
    const spans = exporter.getFinishedSpans();

    // If traceId filter is provided, only count spans with matching traceId
    const matchingSpans = options?.traceId ? spans.filter(s => s.spanContext().traceId === options.traceId) : spans;

    if (matchingSpans.length >= expectedCount) {
      return; // Success
    }
    await Bun.sleep(pollInterval);
  }

  // Timeout - fail with helpful message
  const spans = exporter.getFinishedSpans();
  const matchingSpans = options?.traceId ? spans.filter(s => s.spanContext().traceId === options.traceId) : spans;
  if (options?.traceId || spans.length) printSpans(exporter);
  throw new Error(
    `Timeout waiting for spans. Expected: ${expectedCount}, Found: ${matchingSpans.length}` +
      (options?.traceId
        ? ` with traceId ${options.traceId} (I do have ${spans.length} spans with traceIds [${[...new Set(spans.map(s => s.spanContext().traceId))].join(", ")}])`
        : ""),
  );
}

export function printSpans(exporter: InMemorySpanExporter): void {
  const spans = exporter.getFinishedSpans();
  console.log(`Exported ${spans.length} spans:`);
  for (const span of spans) {
    console.log(
      `- Name: ${span.name}, TraceId: ${span.spanContext().traceId}, SpanId: ${span.spanContext().spanId}, ParentSpanId: ${span.parentSpanContext?.spanId}, Status: ${span.status.code}`,
    );
  }
}

// Test helper: make HTTP request without instrumentation (uses curl)
export async function makeUninstrumentedRequest(url: string, headers: Record<string, string> = {}): Promise<string> {
  const headerFlags = Object.entries(headers).flatMap(([key, value]) => ["-H", `${key}: ${value}`]);
  return await $`curl -s ${headerFlags} ${url}`.text();
}

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
