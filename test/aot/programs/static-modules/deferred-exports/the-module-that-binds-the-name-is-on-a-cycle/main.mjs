import fs from "node:fs";
class Patched {}
fs.WriteStream = Patched;
const a = await import("./a.mjs");
console.log(a.held() === Patched, a.other() === Patched);
