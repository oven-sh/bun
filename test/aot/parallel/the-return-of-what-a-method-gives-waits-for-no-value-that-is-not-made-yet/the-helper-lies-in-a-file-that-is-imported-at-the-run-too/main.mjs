import { head } from "./lib.mjs";
console.log(head("abcd"));
const lib = await import("./lib.mjs");
console.log(Object.keys(lib).length, lib.head("abcdef"));
