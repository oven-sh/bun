// Buffer.concat is the one locked member whose descriptor says writable: false. Every other locked member reports what it reports under plain Bun, and every one of them refuses the store.
"use strict";
const flags = d => (d.writable ? "W" : "-") + (d.enumerable ? "E" : "-") + (d.configurable ? "C" : "-");
function refuses(object, key) {
  try {
    object[key] = function () {};
    return "stored";
  } catch (error) {
    return error.constructor.name;
  }
}
for (const [name, object, key] of [
  ["Buffer.concat", Buffer, "concat"],
  ["Buffer.from", Buffer, "from"],
  ["Buffer.alloc", Buffer, "alloc"],
  ["Buffer.byteLength", Buffer, "byteLength"],
  ["Buffer.prototype.write", Buffer.prototype, "write"],
  ["Math.max", Math, "max"],
  ["Object.assign", Object, "assign"],
  ["Array.prototype.map", Array.prototype, "map"],
  ["Promise.resolve", Promise, "resolve"],
  ["globalThis.Array", globalThis, "Array"],
])
  console.log(
    name,
    flags(Object.getOwnPropertyDescriptor(object, key)),
    flags(Reflect.getOwnPropertyDescriptor(object, key)),
    flags(Object.getOwnPropertyDescriptors(object)[key]),
    Object.getOwnPropertyDescriptor(object, key).value === object[key],
    refuses(object, key),
  );
console.log(require("buffer").Buffer === Buffer, flags(Object.getOwnPropertyDescriptor(require("node:buffer").Buffer, "concat")));
console.log(Object.isFrozen(Buffer), Object.isSealed(Buffer), Object.isExtensible(Buffer), Object.keys(Buffer).includes("concat"));
/* Output:
Buffer.concat -EC -EC -EC true TypeError
Buffer.from WEC WEC WEC true TypeError
Buffer.alloc WEC WEC WEC true TypeError
Buffer.byteLength WEC WEC WEC true TypeError
Buffer.prototype.write WEC WEC WEC true TypeError
Math.max W-C W-C W-C true TypeError
Object.assign W-C W-C W-C true TypeError
Array.prototype.map W-C W-C W-C true TypeError
Promise.resolve W-C W-C W-C true TypeError
globalThis.Array W-C W-C W-C true TypeError
true -EC
false false true true
*/
