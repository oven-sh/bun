import { bench, run } from "../runner.mjs";
import crypto from "node:crypto";
import { Buffer } from "node:buffer";

const keylen = { "aes-128-gcm": 16, "aes-192-gcm": 24, "aes-256-gcm": 32 };
const sizes = [4 * 1024, 1024 * 1024];
const ciphers = ["aes-128-gcm", "aes-192-gcm", "aes-256-gcm"];

const messages = {};
sizes.forEach(size => {
  messages[size] = Buffer.alloc(size, "b");
});

const keys = {};
ciphers.forEach(cipher => {
  keys[cipher] = crypto.randomBytes(keylen[cipher]);
});

// Fixed IV and AAD
const iv = crypto.randomBytes(12);
const associate_data = Buffer.alloc(16, "z");

for (const cipher of ciphers) {
  for (const size of sizes) {
    const message = messages[size];
    const key = keys[cipher];

    bench(`${cipher} ${size / 1024}KB`, () => {
      const alice = crypto.createCipheriv(cipher, key, iv);
      alice.setAAD(associate_data);
      const enc = alice.update(message);
      alice.final();
      const tag = alice.getAuthTag();

      const bob = crypto.createDecipheriv(cipher, key, iv);
      bob.setAuthTag(tag);
      bob.setAAD(associate_data);
      bob.update(enc);
      bob.final();
    });
  }
}

await run();
