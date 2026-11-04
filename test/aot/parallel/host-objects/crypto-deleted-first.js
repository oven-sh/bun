delete globalThis.crypto;
console.log(typeof crypto, require("node:crypto").randomBytes(3).length, typeof require("node:crypto").webcrypto);
