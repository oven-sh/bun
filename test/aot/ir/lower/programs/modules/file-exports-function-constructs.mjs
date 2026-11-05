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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = ImportModule module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Promise flags=[IsExpected]}
// CHECK-NEXT: v2 = Await v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v4 = Builtin builtin=GlobalThis
// CHECK-NEXT: v5 = PropGet v4 key="console" [isFreeName]
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="log"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v9 = Builtin builtin=Object
// CHECK-NEXT: v10 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v11 = Call v10, v9, v3 calleeName="Object.keys"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="join"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v14, v12 calleeKey="join" calleeName="join"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v17 = String string="|"
// CHECK-NEXT: v18 = PropGet v3 key="hidden"
// CHECK-NEXT: v19 = PropGet v3 key="constructor"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v21 = PropHas v3 key="hidden"
// CHECK-NEXT: v22 = PropHas v3 key="constructor"
// CHECK-NEXT: v23 = Builtin builtin=Reflect
// CHECK-NEXT: v24 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v25 = Call v24, v23, v3 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|Array<undefined|null|string|symbol> flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="length"
// CHECK-NEXT: v28 = Convert v27 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v29 = Call v8, v6, v16, v17, v18, v20, v21, v22, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
