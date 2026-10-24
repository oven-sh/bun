import fs from "node:fs";
const first = await import("./first.mjs");
class Patched {}
fs.WriteStream = Patched;
const second = await import("./second.mjs");
console.log(first.held() === second.held(), second.held() === Patched, second.held().name, fs.WriteStream === Patched);
