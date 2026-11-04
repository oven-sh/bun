// Flags: --obfuscate
import * as ns from "./owner.mjs";
console.log(Object.keys(ns).join(), ns.x, typeof ns.f);
