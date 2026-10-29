// A barrel that is imported dynamically and required.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
console.log("main starts");
const first = await import("./barrel.mjs");
console.log(Object.keys(first).join(), first.a, first.b);
const second = require("./other-barrel.mjs");
console.log(Object.keys(second).join(), second.c);
const again = await import("./barrel.mjs");
console.log(again === first, globalThis.ran.join());
