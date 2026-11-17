import { test, expect } from "bun:test";
// The value becomes right at the 5th attempt. The pattern also names the buffer the received object holds (same object). No asymmetric matcher.
for (const size of [200_000, 1_000_000, 2_000_000]) {
  test(`expect.poll + toMatchObject, pattern names a ${size}-byte Uint8Array`, async () => {
    const data = new Uint8Array(size);
    let attempts = 0;
    const t0 = performance.now();
    try {
      await expect.poll(() => ({ state: ++attempts < 5 ? "pending" : "done", data }), { interval: 10, timeout: 1500 }).toMatchObject({ state: "done", data });
    } finally {
      console.log(JSON.stringify({ size, attempts, ms: Math.round(performance.now() - t0) }));
    }
  }, 30000);
}
