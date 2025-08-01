import { bench, run } from "../runner.mjs";

for (let size of [32, 2048, 1024 * 16, 1024 * 1024 * 2, 1024 * 1024 * 16]) {
  for (let fillSize of [4, 8, 16, 11]) {
    const buffer = Buffer.allocUnsafe(size);

    const pattern = "x".repeat(fillSize);

    bench(`Buffer.fill ${size} bytes with ${fillSize} byte value`, () => {
      buffer.fill(pattern);
    });
  }
}

await run();
