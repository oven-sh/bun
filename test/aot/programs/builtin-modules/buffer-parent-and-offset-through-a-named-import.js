// The getters `parent` and `offset` of Buffer.prototype are written in JavaScript. This program gets its buffer from a named import of node:buffer.
import { Buffer as B } from "node:buffer";
const bytes = B.alloc(2);
console.log(bytes.parent.byteLength, bytes.offset);
