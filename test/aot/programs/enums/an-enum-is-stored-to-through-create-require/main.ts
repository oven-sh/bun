import { createRequire } from "node:module";
import { read } from "./reader";
console.log(read());
createRequire(import.meta.url)("./color.ts").Color.Green = 9;
console.log(read());
