// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// An ES importer holds what a CommonJS file exported when it was first imported, whatever happens to the exports object afterwards.
import lib, { used } from "./lib.cjs";
const key = name => (process.argv.length > 99 ? "other" : name);
console.log(used(), lib.used === used);

const original = lib[key("wrapped")];
lib[key("wrapped")] = function () { return "[" + original() + "]"; };
lib[key("replaced")] = function () { return "another function"; };
delete lib[key("deleted")];
Object.defineProperty(lib, key("redefined"), { get() { return "a getter"; }, configurable: true, enumerable: true });
const seen = lib[key("readThenDeleted")];
delete lib[key("readThenDeleted")];

const namespace = await import("./lib.cjs");
console.log(namespace.wrapped === original, namespace.wrapped(), lib.wrapped());
console.log(typeof namespace.replaced, namespace.replaced(), lib.replaced(), namespace.replaced === lib.replaced);
console.log(typeof namespace.deleted, namespace.deleted(), "deleted" in lib);
console.log(typeof namespace.redefined, namespace.redefined(), lib.redefined);
console.log(namespace.readThenDeleted === seen, namespace.readThenDeleted(), "readThenDeleted" in lib);
console.log(namespace.untouched === lib.untouched, namespace.untouched(), lib.untouched());
console.log(namespace.default === lib, namespace.used === used);
console.log(Object.keys(namespace).sort().join());
console.log(Object.keys(lib).join());
const again = await import("./lib.cjs");
console.log(again === namespace, again.replaced === namespace.replaced, again.deleted === namespace.deleted);

// FILE: lib.cjs
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.lib = factory();
})(this, function () {
  var calls = 0;
  return {
    used: function () { return "used " + ++calls; },
    wrapped: function () { return "wrapped " + ++calls; },
    replaced: function () { return "replaced " + ++calls; },
    deleted: function () { return "deleted " + ++calls; },
    redefined: function () { return "redefined " + ++calls; },
    readThenDeleted: function () { return "readThenDeleted " + ++calls; },
    untouched: function () { return "untouched " + ++calls; },
    neverAsked: function () { return "neverAsked " + ++calls; },
  };
});

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: key get
// CHECK-LABEL: function {{*}}name="key"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Process
// CHECK-NEXT: v2 = PropGet v1 key="argv"
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="length"
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = Integer integer=99
// CHECK-NEXT: v7 = Greater v5, v6
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = String string="other"
// CHECK-NEXT: Jump -> next b4(v8)
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4(v0)
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="a getter"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
