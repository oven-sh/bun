import legacy from "./legacy.cjs";
import { right } from "./right.mjs";
const order = globalThis.order;
const at = name => order.indexOf(name);
console.log("main:", legacy, "|", right);
console.log("the leaf of right.mjs runs ahead of the leaf of left.mjs:", at("end rightleaf") < at("begin leftleaf"));
console.log("every file ran once:", order.length === 12 && new Set(order).size === 12);
