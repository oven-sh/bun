import * as ns from "./data.json";
const held = ns;
try {
  held.a = 5;
  console.log("written", held.a);
} catch (error) {
  console.log(error.name);
}
try {
  delete held.a;
  console.log("deleted", held.a);
} catch (error) {
  console.log(error.name);
}
try {
  held.added = 5;
  console.log("added", held.added);
} catch (error) {
  console.log(error.name);
}
console.log(
  ns.a,
  Object.isFrozen(held),
  Object.isSealed(held),
  Object.isExtensible(held),
  String(held[Symbol.toStringTag]),
);
