import { __require } from "./chunk.mjs";
import { read } from "./reader";
console.log(read());
__require("./color.ts").Color.Green = 9;
console.log(read());
