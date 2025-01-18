import { bench, run } from "../runner.mjs";
const crypto = require("node:crypto");

const keyPair = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: "spki",
    format: "pem",
  },
  privateKeyEncoding: {
    type: "pkcs8",
    format: "pem",
  },
});

// Max message size for 2048-bit RSA keys
const plaintext = crypto.getRandomValues(Buffer.alloc(214));

bench("RSA_PKCS1_OAEP_PADDING round-trip", () => {
  const ciphertext = crypto.publicEncrypt(keyPair.publicKey, plaintext);
  crypto.privateDecrypt(keyPair.privateKey, ciphertext);
});

await run();
