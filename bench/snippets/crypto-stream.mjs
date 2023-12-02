// https://github.com/oven-sh/bun/issues/2190
import { bench, run } from "mitata";
import { createHash } from "node:crypto";

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
    const hasher = createHash(alg);
    hasher.write(data);
    hasher.end();
    hasher.read();
  });
}

run();
