// https://github.com/oven-sh/bun/issues/2190
import { createHash } from "node:crypto";
import { bench, run } from "../runner.mjs";

const data =
  "Delightful remarkably mr on announcing themselves entreaties favourable. About to in so terms voice at. Equal an would is found seems of. The particular friendship one sufficient terminated frequently themselves. It more shed went up is roof if loud case. Delay music in lived noise an. Beyond genius really enough passed is up.";

const scenarios = [
  { alg: "md5", digest: "hex" },
  { alg: "md5", digest: "base64" },
  { alg: "sha1", digest: "hex" },
  { alg: "sha1", digest: "base64" },
  { alg: "sha256", digest: "hex" },
  { alg: "sha256", digest: "base64" },
];

for (const { alg, digest } of scenarios) {
  bench(`${alg}-${digest}`, () => {
    createHash(alg).update(data).digest(digest);
  });

  if ("Bun" in globalThis) {
    bench(`${alg}-${digest} (Bun.CryptoHasher)`, () => {
      new Bun.CryptoHasher(alg).update(data).digest(digest);
    });
  }
}

run();
