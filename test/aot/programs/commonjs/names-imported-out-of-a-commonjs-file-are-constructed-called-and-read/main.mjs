import whole, { Point, make, later, viaGetter, counter, replaced } from "./plain.cjs";
import fn, { Inner, version } from "./function.cjs";
import { early } from "./cycle.cjs";
import { Readable, Transform } from "node:stream";
import { EventEmitter } from "node:events";
import { join } from "node:path";

function build(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += new Point(i, 1).sum() + make(i).x + new Inner(i).value;
  return sum;
}

console.log(build(10), typeof later, viaGetter, counter, replaced());
whole.bump();
whole.Point = class {
  sum() {
    return -1;
  }
};
whole.later = 5;
console.log(build(10), typeof later, viaGetter, counter, whole.counter, new whole.Point().sum(), whole.replaced());
console.log(fn(2), version, fn.version, early, new Inner(3) instanceof fn.Inner);
const readable = new Readable({ read() {} });
console.log(readable instanceof EventEmitter, new Transform() instanceof Readable, readable.readableLength, join("a", "..", "b"));
