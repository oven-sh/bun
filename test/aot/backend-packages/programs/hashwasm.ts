import { argon2id, bcrypt, sha256, xxhash64 } from "hash-wasm";
import { timed } from "./lib_http.ts";

console.log(await sha256("abc"), await xxhash64("abc"));
console.log(await timed("argon2id, 8 MB, 3 passes", () => argon2id({ password: "password", salt: new Uint8Array(16).fill(7), parallelism: 1, iterations: 3, memorySize: 8192, hashLength: 32, outputType: "hex" })));
console.log(await timed("bcrypt, 8 rounds", () => bcrypt({ password: "password", salt: new Uint8Array(16).fill(7), costFactor: 8, outputType: "encoded" })));
const big = new Uint8Array(16 << 20).fill(5);
console.log(await timed("sha256 of 16 MB", () => sha256(big)));
console.log("DONE");
