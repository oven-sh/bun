import { bench, run } from "./runner.mjs";
bench("performance.now x 1000", () => {
  for (let i = 0; i < 1000; i++) {
    performance.now();
  }
});

if ("Bun" in globalThis) {
  var nanoseconds = Bun.nanoseconds;
  bench("Bun.nanoseconds x 1000", () => {
    for (let i = 0; i < 1000; i++) {
      nanoseconds();
    }
  });
}
await run();
