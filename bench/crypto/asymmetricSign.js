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
const plaintext = crypto.getRandomValues(Buffer.alloc(245));

bench("RSA sign RSA_PKCS1_PADDING round-trip", () => {
  const sig = crypto.privateEncrypt(keyPair.privateKey, plaintext);
  crypto.publicDecrypt(keyPair.publicKey, sig);
});

await run();
