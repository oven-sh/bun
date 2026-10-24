import fs, { existsSync } from "node:fs";
class Patched {}
fs.WriteStream = Patched;
const user = await import("./user.mjs");
console.log(existsSync("/"), user.held() === Patched, typeof user.all().readFile);
