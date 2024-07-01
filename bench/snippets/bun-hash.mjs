import { bench, group, run } from "./runner.mjs";

const hashes = ["wyhash", "adler32", "crc32", "cityHash32", "cityHash64", "murmur32v3", "murmur32v2", "murmur64v2"];

group("hello world", () => {
  for (const name of hashes) {
    const fn = Bun.hash[name];

    bench(`${name}`, () => {
      return fn("hello world");
    });
  }
});

group("hello world (x 1024)", () => {
  for (const name of hashes) {
    const fn = Bun.hash[name];

    const repeated = Buffer.alloc("hello world".length * 1024, "hello world").toString();
    bench(`${name}`, () => {
      return fn(repeated);
    });
  }
});

await run();
