import fs, { existsSync } from "node:fs";
class Patched {}
fs.WriteStream = Patched;
const barrel = await import("./barrel.mjs");
console.log(existsSync("/"), typeof barrel.promises, barrel.WriteStream === Patched, Object.keys(barrel).join());
const user = await import("./user.mjs");
console.log(user.held() === Patched, user.readFile === fs.promises.readFile);
