import crypto from "node:crypto";

console.log(crypto.randomFillSync(new Uint8Array(4)).length);
