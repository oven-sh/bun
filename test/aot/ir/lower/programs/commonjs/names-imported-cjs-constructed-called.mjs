// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

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

// GENERATED: build sum read
// CHECK-LABEL: function {{*}}name="build"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v2, v4)
// CHECK-NEXT: b1(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Less v6, v0
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="Point"
// CHECK-NEXT: v11 = Integer integer=1
// CHECK-NEXT: v12 = Construct v10, -, v6, v11 calleeName="Point"
// CHECK-NEXT: v13 = PropGet v12 key="sum"
// CHECK-NEXT: v14 = Call v13, v12 calleeKey="sum" calleeName="sum"
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="make"
// CHECK-NEXT: v17 = Call v16, -, v6 calleeName="make"
// CHECK-NEXT: v18 = PropGet v17 key="x"
// CHECK-NEXT: v19 = Add v14, v18
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="Inner"
// CHECK-NEXT: v22 = Construct v21, -, v6 calleeName="Inner"
// CHECK-NEXT: v23 = PropGet v22 key="value"
// CHECK-NEXT: v24 = Add v19, v23
// CHECK-NEXT: v25 = Add v5, v24
// CHECK-NEXT: v26 = Convert v25 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v27 = Increment v6
// CHECK-NEXT: v28 = Convert v27 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v26, v28)
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=-1
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
