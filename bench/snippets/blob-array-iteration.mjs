import { bench, run } from "../runner.mjs";

const N100 = Array.from({ length: 100 }, (_, i) => `chunk-${i}`);
const N1000 = Array.from({ length: 1000 }, (_, i) => `data-${i}`);
const N10000 = Array.from({ length: 10000 }, (_, i) => `x${i}`);

bench("new Blob([100 strings])", () => new Blob(N100));
bench("new Blob([1000 strings])", () => new Blob(N1000));
bench("new Blob([10000 strings])", () => new Blob(N10000));

// Mixed: strings + buffers
const mixed = [];
for (let i = 0; i < 100; i++) {
  mixed.push(`text-${i}`);
  mixed.push(new Uint8Array([i, i + 1, i + 2]));
}
bench("new Blob([100 strings + 100 buffers])", () => new Blob(mixed));

await run();
