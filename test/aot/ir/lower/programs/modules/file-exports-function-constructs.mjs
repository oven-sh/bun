// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.mjs
// A CommonJS file exports what `new` makes of a function that stores `constructor` on it.
const names = await import("./first.cjs");
console.log(
  Object.keys(names).join(),
  "|",
  names.hidden,
  names.constructor,
  "hidden" in names,
  "constructor" in names,
  Reflect.ownKeys(names).length,
);

// FILE: first.cjs
function Made() {
  this.one = 1;
  this.constructor = 3;
}
module.exports = new Made();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = ImportModule module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v1 = Await v0
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = Builtin builtin=Object
// CHECK-NEXT: v8 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v9 = Call v8, v7, v1 calleeName="Object.keys"
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = Call v10, v9 calleeKey="join" calleeName="join"
// CHECK-NEXT: v12 = String string="|"
// CHECK-NEXT: v13 = PropGet v1 key="hidden"
// CHECK-NEXT: v14 = PropGet v1 key="constructor"
// CHECK-NEXT: v15 = PropHas v1 key="hidden"
// CHECK-NEXT: v16 = PropHas v1 key="constructor"
// CHECK-NEXT: v17 = Builtin builtin=Reflect
// CHECK-NEXT: v18 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v19 = Call v18, v17, v1 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v20 = PropGet v19 key="length"
// CHECK-NEXT: v21 = Call v6, v4, v11, v12, v13, v14, v15, v16, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
