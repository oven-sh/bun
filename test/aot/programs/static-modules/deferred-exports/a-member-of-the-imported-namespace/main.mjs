import fs, { existsSync } from "node:fs";
class Patched {}
fs.WriteStream = Patched;
const rest = await import("./rest.mjs");
console.log(existsSync("/"), rest.held() === Patched, rest.names().includes("promises"), typeof rest.whole().promises);
