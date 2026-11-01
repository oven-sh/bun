// Text that nobody knows at the build runs in the interpreter. It makes closures of one function with a prototype object each. The interpreter's accesses by name notice that,
// and the engine gives all further objects one Structure that has no prototype: each object keeps its own. Compiled code reads them by name until the access remembers that Structure,
// the objects die, and a full collection looks at what the accesses remember.
import { describe } from "bun:jsc";
const text = `
  let seen = 0;
  function peek(thing) { return thing.x; }
  return function make(tag) {
    function Thing() { this.x = tag; this.y = tag + 1; }
    Thing.prototype.kind = function () { return tag; };
    const thing = new Thing();
    seen += peek(thing);
    return thing;
  };
` + " ".repeat(process.argv.length);
const make = new Function(text)();
function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i].x;
  return total;
}
function round(count) {
  const kept = [];
  for (let i = 0; i < count; i++) kept.push(make(i));
  let total = 0;
  for (let k = 0; k < 20; k++) total += sum(kept);
  return [total, describe(kept[count - 1]).includes("PolyProto")];
}
function scrub(depth) {
  return depth ? scrub(depth - 1) + depth : 0;
}
let total = 0;
let keepsPrototypeInObject = false;
for (let r = 0; r < 10; r++) {
  const [t, p] = round(500);
  total += t;
  keepsPrototypeInObject = p;
  total += scrub(200) - scrub(200);
  Bun.gc(true);
}
console.log(total, keepsPrototypeInObject);
