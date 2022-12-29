// so it can run in environments without node module resolution
import { bench, run } from "mitata";

import crypto from "node:crypto";

var foo = new Uint8Array(65536);
crypto.getRandomValues(foo);

// if ("Bun" in globalThis) {
//   const { CryptoHasher } = Bun;
//   bench("CryptoHasher Blake2b256", () => {
//     var hasher = new CryptoHasher("blake2b256");
//     hasher.update(foo);
//     hasher.digest();
//   });
// }

bench('crypto.createHash("sha512")', () => {
  var hasher = crypto.createHash("sha512");
  hasher.update(foo);
  hasher.digest();
});

bench('crypto.createHash("sha512")', () => {
  var hasher = crypto.createHash("sha512");
  hasher.update(foo);
  hasher.digest();
});

await run();
