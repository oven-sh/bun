import process, { platform } from "node:process";
const replaced = { write: text => console.log("replaced:", text) };
Object.defineProperty(process, "stdout", { value: replaced, configurable: true, enumerable: true, writable: true });
const rest = await import("./rest.mjs");
console.log(typeof platform, rest.held() === replaced, rest.error() === process.stderr);
rest.held().write("written");
