// RUN: lower
// OPTIONS: builtin-modules

// FILE: function-bundle-cjs-format-bun-build.cjs
// @bun @bun-cjs
// A function of a bundle in the commonjs format of bun build has a strict directive.
(function(exports, require, module, __filename, __dirname) {// One function of the bundle starts with "use strict", another does not.
function strict() {
  "use strict";
  return typeof this;
}
function sloppy() {
  return typeof this;
}
function storeInStrict() {
  "use strict";
  try {
    undeclaredInStrict = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
function storeInSloppy() {
  undeclaredInSloppy = 1;
  return typeof undeclaredInSloppy;
}
const inner = function () {
  "use strict";
  return (() => typeof this)() + " " + (function () { return typeof this; })();
};
console.log(strict(), sloppy(), storeInStrict(), storeInSloppy(), inner());
})

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: sloppy storeInStrict storeInSloppy inner
// CHECK-LABEL: function {{*}}name="sloppy"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToThis v0
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="storeInStrict"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: PropSet v1, v0 key="undeclaredInStrict" [isFreeName]
// CHECK-NEXT: v3 = String string="stored"
// CHECK-NEXT: Return v3
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v4 = CatchValue
// CHECK-NEXT: v5 = PropGet v4 key="name"
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="storeInSloppy"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: PropSet v1, v0 key="undeclaredInSloppy" mode=Sloppy [isFreeName]
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="undeclaredInSloppy" [isFreeName, isForTypeOf]
// CHECK-NEXT: v5 = TypeOf v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inner"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_2]]
// CHECK-NEXT: v2 = Call v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: v4 = String string=" "
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: v6 = NewClosure function=[[f_3]]
// CHECK-NEXT: v7 = Call v6
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined" flags=[IsExpected]}
// CHECK-NEXT: v9 = Add v5, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
