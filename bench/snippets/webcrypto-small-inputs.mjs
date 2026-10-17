// Hashes and symmetric ciphers of crypto.subtle over small inputs: one operation awaited at a time,
// the way a request that signs or verifies a token does, and a thousand of them started at once.
import { bench, group, run } from "../runner.mjs";

const { subtle } = crypto;
const raw = new Uint8Array(32).fill(1);
const iv = new Uint8Array(12).fill(2);
const hmac256 = await subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
const hmac512 = await subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
const gcm = await subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);

const BATCH = 1000;

for (const size of [64, 256, 768, 4096]) {
  const data = new Uint8Array(size).fill(7);
  const operations = {
    "digest SHA-256": () => subtle.digest("SHA-256", data),
    "digest SHA-512": () => subtle.digest("SHA-512", data),
    "HMAC SHA-256 sign": () => subtle.sign("HMAC", hmac256, data),
    "HMAC SHA-512 sign": () => subtle.sign("HMAC", hmac512, data),
    "AES-256-GCM encrypt": () => subtle.encrypt({ name: "AES-GCM", iv }, gcm, data),
  };

  group(`${size} bytes`, () => {
    for (const [name, operation] of Object.entries(operations)) {
      bench(`${name} (${size} bytes)`, async () => {
        await operation();
      });
      bench(`${name} (${size} bytes) x ${BATCH} at once`, async () => {
        await Promise.all(Array.from({ length: BATCH }, operation));
      });
    }
  });
}

await run();
