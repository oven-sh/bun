import { bench, run } from "../runner.mjs";

// Accumulating into a Blob by re-wrapping it. Each case builds the whole chain,
// so the per-iteration cost should grow linearly with the number of chunks.
const chunk64KiB = new Uint8Array(64 * 1024);
const chunk64B = new Uint8Array(64);

function accumulate(chunk, count) {
  let blob = new Blob([chunk]);
  for (let i = 1; i < count; i++) blob = new Blob([blob, chunk]);
  return blob;
}

bench("b = new Blob([b, 64 KiB chunk]) x 64", () => accumulate(chunk64KiB, 64));
bench("b = new Blob([b, 64 KiB chunk]) x 256", () => accumulate(chunk64KiB, 256));
bench("b = new Blob([b, 64 B chunk]) x 1024", () => accumulate(chunk64B, 1024));
bench("b = new Blob([b, 64 B chunk]) x 4096", () => accumulate(chunk64B, 4096));

const oneMiB = new Blob([new Uint8Array(1024 * 1024)]);
bench("new Blob([1 MiB blob, 64 B chunk]) once", () => new Blob([oneMiB, chunk64B]));

await run();
