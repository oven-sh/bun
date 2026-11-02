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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v9 = Less v6, v8
// CHECK-NEXT: Branch v9 -> taken b3(| 0, 1), notTaken b6(| 0, 1)
// CHECK-NEXT: b3(v10, v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="Point"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v15 = Integer integer=1
// CHECK-NEXT: v16 = Construct v14, -, v10, v15 calleeName="Point"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="sum"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v20 = Call v19, v17 calleeKey="sum" calleeName="sum"
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v22 = CheckInitialized v21 name="make"
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v24 = Call v23, -, v10 calleeName="make"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v26 = PropGet v25 key="x"
// CHECK-NEXT: v27 = Add v20, v26
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v29 = CheckInitialized v28 name="Inner"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v31 = Construct v30, -, v10 calleeName="Inner"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|number|string|symbol|bigint|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="value"
// CHECK-NEXT: v34 = Add v27, v33
// CHECK-NEXT: v35 = Add v5, v34
// CHECK-NEXT: v36 = Convert v35 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v37 = Increment v10
// CHECK-NEXT: v38 = Convert v37 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v36, v38)
// CHECK-NEXT: b6(v39, v40):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v41 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v41
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=-1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
