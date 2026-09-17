import crypto from "node:crypto";
import { bench, run } from "../runner.mjs";

for (const size of [16, 32, 64, 256, 1024, 4096, 65536]) {
  const a = crypto.randomBytes(size);
  const b = Buffer.from(a);

  bench(`timingSafeEqual - ${size} bytes`, () => {
    return crypto.timingSafeEqual(a, b);
  });
}

await run();
