import fs, { existsSync } from "node:fs";
class Patched {}
fs.WriteStream = Patched;
const top = await import("./top.mjs");
console.log(existsSync("/"), top.held() === Patched);
