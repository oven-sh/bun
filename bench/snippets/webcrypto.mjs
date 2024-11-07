import { bench, group, run } from "../runner.mjs";

const sizes = [
  ["small (63 bytes)", 63],
  ["medium (4096 bytes)", 4096],
  ["large (64 MB)", 64 * 1024 * 1024],
];
for (let [name, size] of sizes) {
  group(name, () => {
    var buf = new Uint8Array(size);
    for (let algorithm of ["SHA-1", "SHA-256", "SHA-384", "SHA-512"]) {
      bench(`${algorithm} (${name})`, async () => {
        await crypto.subtle.digest(algorithm, buf);
      });
    }
  });
}

await run();
