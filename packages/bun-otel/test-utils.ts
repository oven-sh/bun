/**
 * Test utilities for bun-otel tests
 */
import type { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";

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
  throw new Error(
    `Timeout waiting for spans. Expected: ${expectedCount}, Found: ${matchingSpans.length}` +
      (options?.traceId ? ` with traceId ${options.traceId}` : ""),
  );
}
