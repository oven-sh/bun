// Buffer.from is written in JavaScript. This program names it only through a named import of node:buffer, and nothing else in it uses Buffer.
import { Buffer as B } from "node:buffer";
console.log(B.from("abc", "utf8").length, B.from(new Uint8Array([1, 2, 3])).length, B.from(new ArrayBuffer(4), 1, 2).length, B.from({ length: 1, 0: 7 })[0]);
