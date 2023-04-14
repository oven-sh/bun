// https://github.com/oven-sh/bun/issues/2190
import { bench, run } from "mitata";
import { createHash } from "node:crypto";

const data =
  "Delightful remarkably mr on announcing themselves entreaties favourable. About to in so terms voice at. Equal an would is found seems of. The particular friendship one sufficient terminated frequently themselves. It more shed went up is roof if loud case. Delay music in lived noise an. Beyond genius really enough passed is up.";

const cyrb53 = (str, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed,
    h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

const scenarios = [
  { alg: "md5", digest: "hex" },
  { alg: "md5", digest: "base64" },
  { alg: "sha1", digest: "hex" },
  { alg: "sha1", digest: "base64" },
  { alg: "sha256", digest: "hex" },
  { alg: "sha256", digest: "base64" },
  { alg: "cyrb53", digest: "hex" },
];

for (const { alg, digest } of scenarios) {
  bench(`${alg}-${digest}`, () => {
    if (alg === "cyrb53") cyrb53(data);
    else createHash(alg).update(data).digest(digest);
  });

  if (alg !== "cyrb53" && "Bun" in globalThis) {
    bench(`${alg}-${digest} (Bun.CryptoHasher)`, () => {
      new Bun.CryptoHasher(alg).update(data).digest(digest);
    });
  }
}

run();
