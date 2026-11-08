// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4
// CHECK-LABEL: function {{*}}name="build"
// CHECK-LABEL: function {{*}}name="sum"
// CHECK-LABEL: function {{*}}name="read"

// FILE: main.mjs
// Names imported out of a commonjs file are constructed called and read.
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

// FILE: cycle.cjs
exports.early = "set before the file ends";
const again = require("./cycle.cjs");
exports.early = again.early + "!";

// FILE: function.cjs
function double(x) {
  return x * 2;
}
double.Inner = function Inner(value) {
  this.value = value;
};
double.version = "1";
module.exports = double;

// FILE: plain.cjs
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
let reads = 0;
exports.Point = Point;
exports.make = x => new Point(x, 0);
exports.counter = 0;
exports.later = undefined;
exports.bump = () => ++exports.counter;
exports.replaced = () => "first";
exports.replaced = () => "second";
Object.defineProperty(exports, "viaGetter", { enumerable: true, get: () => ++reads });
Object.defineProperty(exports, "hidden", { enumerable: false, value: 1 });
setTimeout(() => {
  exports.later = () => 1;
});

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
