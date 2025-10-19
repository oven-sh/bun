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
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 5; // Poll every 5ms

  while (Date.now() - startTime < timeoutMs) {
    const spans = exporter.getFinishedSpans();
    if (spans.length >= expectedCount) {
      return; // Success
    }
    await Bun.sleep(pollInterval);
  }

  // Timeout - fail with helpful message
  const actual = exporter.getFinishedSpans().length;
  throw new Error(`Timeout waiting for spans. Expected: ${expectedCount}, Found: ${actual}`);
}
