// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// deep.cjs walks from require.main over all the children and changes what each file exports.
const Required = require("./counter.cjs");
function total(Class) {
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum = (sum + new Class().add(i)) | 0;
  return sum;
}
exports.label = "main";
const middle = require("./middle.cjs");
console.log(total(Required), Required.label, middle.label, exports.label, middle.double(4));
middle.walk();
console.log(total(Required), Required.label, middle.label, exports.label, middle.double(4));

// FILE: counter.cjs
module.exports = class Counter {
  constructor() {
    this.n = 1;
  }
  add(x) {
    this.n = (this.n + x) | 0;
    return this.n;
  }
};
module.exports.label = "first";

// FILE: deep.cjs
module.exports = function walk() {
  const seen = new Set();
  const visit = file => {
    if (seen.has(file)) return;
    seen.add(file);
    file.exports.label = seen.size;
    if (file.exports.double) file.exports.double = x => x + "!";
    if (file.exports.prototype?.add) file.exports.prototype.add = x => x + 0.5;
    for (const child of file.children) visit(child);
  };
  visit(require.main);
};

// FILE: middle.cjs
exports.label = "middle";
exports.double = x => x * 2;
exports.walk = require("./deep.cjs");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: total
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v2, v4)
// CHECK-NEXT: b1(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Integer integer=1000
// CHECK-NEXT: v9 = Less v6, v8
// CHECK-NEXT: Branch v9 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v10 = Construct v0 calleeName="Class"
// CHECK-NEXT: v11 = PropGet v10 key="add"
// CHECK-NEXT: v12 = Call v11, v10, v6 calleeKey="add" calleeName="add"
// CHECK-NEXT: v13 = Add v5, v12
// CHECK-NEXT: v14 = Integer
// CHECK-NEXT: v15 = BitOr v13, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v17 = Increment v6
// CHECK-NEXT: v18 = Convert v17 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v16, v18)
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
