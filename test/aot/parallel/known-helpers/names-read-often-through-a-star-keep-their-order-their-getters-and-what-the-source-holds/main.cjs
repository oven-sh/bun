// `__exportStar(require("./leaf.cjs"), exports)` read from another file a thousand times: the getters of the star come to lie in the slots that the layout of the exports has for them. Keys, descriptors and what the source holds later stay as plain Bun has them.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const barrel_1 = require("./barrel.cjs");
const leaf_1 = require("./leaf.cjs");
function turn(i) { return (0, barrel_1.add)(i, barrel_1.two); }
let sum = 0;
for (let i = 0; i < 1000; i++) sum += turn(i & 7);
console.log(sum);
console.log(Object.keys(barrel_1).join(), JSON.stringify(barrel_1), "add" in barrel_1, "default" in barrel_1, barrel_1.__esModule);
for (const key of Reflect.ownKeys(barrel_1)) {
  const d = Object.getOwnPropertyDescriptor(barrel_1, key);
  console.log(key, "get" in d ? "getter" : "value", d.enumerable, d.configurable, d.writable, d.set);
}
console.log(Object.getOwnPropertyDescriptor(barrel_1, "add").get === Object.getOwnPropertyDescriptor(barrel_1, "add").get);
leaf_1.change();
console.log(barrel_1.two, turn(1), barrel_1.own, barrel_1.late);
for (const action of [() => { barrel_1.two = 1; }, () => delete barrel_1.two, () => Object.defineProperty(barrel_1, "two", { value: 1 })]) {
  try { console.log(action()); } catch (error) { console.log(error.constructor.name); }
}
sum = 0;
for (let i = 0; i < 1000; i++) sum += turn(i & 7);
console.log(sum);
