import crypto from "node:crypto";
import { bench, run } from "../runner.mjs";

// Sample keys with different lengths
const keys = {
  short: "secret",
  long: "this-is-a-much-longer-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

// Test parameters
const salts = ["", "salt"];
const infos = ["", "info"];
const hashes = ["sha256", "sha512"];
const sizes = [10, 1024];
const secretKey = crypto.createSecretKey(keys.long, "utf8");

// Benchmark sync HKDF
for (const hash of hashes) {
  for (const keyName of Object.keys(keys)) {
    const key = keys[keyName];
    for (const size of sizes) {
      bench(`hkdfSync ${hash} ${keyName}-key ${size} bytes`, () => {
        return crypto.hkdfSync(hash, key, "salt", "info", size);
      });
    }
  }
}

// Benchmark different combinations of salt and info
for (const salt of salts) {
  for (const info of infos) {
    bench(`hkdfSync sha256 with ${salt ? "salt" : "no-salt"} and ${info ? "info" : "no-info"}`, () => {
      return crypto.hkdfSync("sha256", "secret", salt, info, 64);
    });
  }
}

// The same derivations with Buffer inputs
const keyBuffers = { short: Buffer.from(keys.short), long: Buffer.from(keys.long) };
const saltBuffer = Buffer.from("salt");
const infoBuffer = Buffer.from("info");
for (const hash of hashes) {
  for (const keyName of Object.keys(keyBuffers)) {
    const key = keyBuffers[keyName];
    for (const size of sizes) {
      bench(`hkdfSync ${hash} ${keyName}-key ${size} bytes (Buffer inputs)`, () => {
        return crypto.hkdfSync(hash, key, saltBuffer, infoBuffer, size);
      });
    }
  }
}

bench("hkdfSync sha256 KeyObject key (Buffer inputs)", () => {
  return crypto.hkdfSync("sha256", secretKey, saltBuffer, infoBuffer, 64);
});

// Benchmark async HKDF (using promises for cleaner benchmark)
// Note: async benchmarks in Mitata require returning a Promise
for (const hash of hashes) {
  bench(`hkdf ${hash} async`, async () => {
    return new Promise((resolve, reject) => {
      crypto.hkdf(hash, "secret", "salt", "info", 64, (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey);
      });
    });
  });
}

bench("hkdf sha256 async (Buffer inputs)", async () => {
  return new Promise((resolve, reject) => {
    crypto.hkdf("sha256", keyBuffers.short, saltBuffer, infoBuffer, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
});

await run();
