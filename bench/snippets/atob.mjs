import { bench, run } from "../runner.mjs";

function makeBenchmark(size) {
  const latin1 = btoa("A".repeat(size));

  bench(`atob(${size} chars)`, () => {
    atob(latin1);
  });
}

[32, 512, 64 * 1024, 512 * 1024, 1024 * 1024 * 8].forEach(makeBenchmark);

await run();
