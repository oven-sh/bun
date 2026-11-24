import * as zlib from "node:zlib";
import * as crypto from "node:crypto";
const table = { zlib, crypto };
const pick = name => table[process.argv.length > 99 ? "none" : name.split("").join("")];
console.log(pick("zlib").brotliDecompressSync(pick("zlib").brotliCompressSync("hello")).toString(), pick("crypto").createHash("sha256").update("a").digest("hex").slice(0, 8));
