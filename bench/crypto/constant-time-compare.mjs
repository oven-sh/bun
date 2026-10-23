import crypto from "node:crypto";
import { bench, run } from "../runner.mjs";

// Both compares go through BoringSSL CRYPTO_memcmp.
for (const size of [16, 64, 256, 1024, 4096, 65536]) {
  const bytes = crypto.randomBytes(size);
  const copy = Buffer.from(bytes);
  const key = crypto.createSecretKey(bytes);
  const sameKey = crypto.createSecretKey(copy);

  bench(`timingSafeEqual - ${size} bytes`, () => {
    return crypto.timingSafeEqual(bytes, copy);
  });

  bench(`KeyObject.equals - ${size} bytes`, () => {
    return key.equals(sameKey);
  });
}

await run();
