import defer * as a from "./a.mjs";
console.log("main begins");
const held = a;
console.log(
  typeof held,
  held === a,
  Object.prototype.toString.call(held),
  held[Symbol.toStringTag],
  typeof held.then,
  held[Symbol.iterator],
  Object.isExtensible(held),
  Symbol.toStringTag in held,
);
console.log("still not evaluated");
console.log(Object.keys(held).join());
