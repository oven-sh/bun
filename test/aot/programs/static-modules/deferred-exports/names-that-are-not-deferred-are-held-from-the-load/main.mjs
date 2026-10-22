import fs from "node:fs";
const original = fs.readFileSync;
fs.readFileSync = () => "patched";
const rest = await import("./rest.mjs");
console.log(rest.held() === original, rest.held() === fs.readFileSync);
