// Buffer.from is written in JavaScript. This program names it only through the namespace object of node:buffer.
import * as buffer from "node:buffer";
console.log(buffer.Buffer.from("abc").length);
