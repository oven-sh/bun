import { pbkdf2, pbkdf2Sync } from "node:crypto";

import { bench, run } from "./runner.mjs";

const password = "password";
const salt = "salt";
const iterations = 1000;
const keylen = 32;
const hash = "sha256";

bench("pbkdf2(iterations = 1000, 'sha256') -> 32", async () => {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, keylen, hash, (err, key) => {
      if (err) return reject(err);
      resolve(key);
    });
  });
});

bench("pbkdf2(iterations = 500_000, 'sha256') -> 32", async () => {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, 500_000, keylen, hash, (err, key) => {
      if (err) return reject(err);
      resolve(key);
    });
  });
});

await run();
