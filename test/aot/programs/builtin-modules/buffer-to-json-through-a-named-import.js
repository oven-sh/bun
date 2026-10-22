// Buffer.prototype.toJSON is written in JavaScript. This program gets its buffers from a named import of node:buffer, calls it, and lets JSON.stringify call it.
import { Buffer as B } from "node:buffer";
console.log(B.alloc(2).toJSON(), JSON.stringify(B.alloc(2)), JSON.stringify({ bytes: B.alloc(1, 7) }));
