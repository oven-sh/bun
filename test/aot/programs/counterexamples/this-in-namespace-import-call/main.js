// `ns.who()` on `import * as ns` is called with the namespace object as `this`.
import * as ns from "./main.js";
export function who() { return typeof this; }
console.log(ns.who());
