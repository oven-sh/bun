import fs from "node:fs";
const all = await import("node:fs");
const seen = all.WriteStream;
class Patched {}
fs.WriteStream = Patched;
const rest = await import("./rest.mjs");
console.log(rest.held() === seen, rest.held() === Patched, all.WriteStream === seen);
