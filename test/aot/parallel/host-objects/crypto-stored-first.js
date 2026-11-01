globalThis.crypto = { randomUUID: () => "fixed" };
const bytes = require("node:crypto").getRandomValues(new Uint8Array(2));
console.log(bytes.length, typeof require("node:crypto").webcrypto, typeof require("node:crypto").subtle, crypto.randomUUID());
