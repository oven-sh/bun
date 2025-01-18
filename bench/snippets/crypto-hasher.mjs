// so it can run in environments without node module resolution
import { bench, run } from "../runner.mjs";

import crypto from "node:crypto";

var foo = Buffer.allocUnsafe(512);
foo.fill(123);

// if ("Bun" in globalThis) {
//   const { CryptoHasher } = Bun;
//   bench("Bun.CryptoHasher(sha512)", () => {
//     var hasher = new CryptoHasher("sha512");
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
