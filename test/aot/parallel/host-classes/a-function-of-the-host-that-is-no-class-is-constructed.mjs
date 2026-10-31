// SlowBuffer is a function, not a class: `new` runs it, and the Buffer that it answers takes the place of the new object.
import { SlowBuffer } from "node:buffer";

function make() { return new SlowBuffer(4); }
function offset() { return make().offset; }
function parent() { return typeof make().parent; }
console.log("by new:", offset(), parent());
console.log("by Reflect.construct:", Reflect.construct(SlowBuffer, [4]).offset);
