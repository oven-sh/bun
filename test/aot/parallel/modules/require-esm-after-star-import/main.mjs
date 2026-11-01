// `import * as` creates the namespace object at link time. A later require() answers with that object, which is not extensible.
import * as one from "./e1.mjs";
import * as two from "./e2.mjs";
import { x as three } from "./e3.mjs";
export * as four from "./e4.mjs";
import * as five from "./e5.mjs";
import "./inner.mjs";
import r from "./r.cjs";
console.log("e1 star, used as a value", Object.isExtensible(r.e1()), r.e1() === one);
console.log("e2 star, members only", Object.isExtensible(r.e2()), two.x);
console.log("e3 name", Object.isExtensible(r.e3()), three);
console.log("e4 export star as", Object.isExtensible(r.e4()));
console.log("e5", Object.isExtensible(five));
const six = await import("./e6.mjs");
console.log("e6 import()", Object.isExtensible(r.e6()), r.e6() === six);
