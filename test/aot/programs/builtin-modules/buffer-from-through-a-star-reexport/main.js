// Buffer.from is written in JavaScript. This program names it only through a module of its own that exports everything of node:buffer again.
import { Buffer as B } from "./again.js";
console.log(B.from("abc").length);
