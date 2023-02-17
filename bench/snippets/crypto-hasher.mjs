// so it can run in environments without node module resolution
import { bench, run } from "mitata";

import crypto from "node:crypto";

var foo = Buffer.allocUnsafe(16384);
foo.fill(123);

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

bench('crypto.createHash("sha256")', () => {
  var hasher = crypto.createHash("sha256");
  hasher.update(foo);
  hasher.digest();
});

bench('crypto.createHash("sha1")', () => {
  var hasher = crypto.createHash("sha1");
  hasher.update(foo);
  hasher.digest();
});

await run();
