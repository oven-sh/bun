// Built with --obfuscate, which leaves the paths of the files out of the executable. An ES file whose first request is a require() of a CommonJS file still exports what its own `export` statements say.
// Flags: --obfuscate
import * as ns from "./owner.mjs";
import * as file from "./k.cjs";
console.log(Object.keys(ns).join(), ns.x, ns.f(), ns.a, "default" in ns);
console.log(Object.keys(file).join(), file.a, file.default.b);
const name = ["./owner", "mjs"].join(".");
const again = await import(name);
console.log(Object.keys(again).join(), again === ns);
