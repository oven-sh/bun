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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5, v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Integer integer=1000
// CHECK-NEXT: v9 = Less v6, v8
// CHECK-NEXT: Branch v9 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v11 = Construct v0 calleeName="Class"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="add"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v14, v12, v10 calleeKey="add" calleeName="add"
// CHECK-NEXT: v16 = Convert v15 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v17 = Add v5, v16
// CHECK-NEXT: v18 = Integer
// CHECK-NEXT: v19 = BitOr v17, v18
// CHECK-NEXT: v20 = Convert v19 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v21 = Increment v10
// CHECK-NEXT: v22 = Convert v21 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2(v20, v22)
// CHECK-NEXT: b6(v23):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v24 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
