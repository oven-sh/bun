// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 5

// FILE: main.mjs
// Two modules wait for a module that awaits. The first of them to go on requires a module that imports the second, which has not gone on yet, so require() throws. The required module runs as soon as the second has, and a later import() of it settles. Plain Bun prints another output.
Promise.all([import("./requires.mjs"), import("./waits.mjs")]).then(() => {
  console.log("both are imported");
  import("./required.mjs").then(names => console.log("required is imported:", Object.keys(names).join()));
});

// FILE: awaits.mjs
console.log("awaits begins");
await 0;
console.log("awaits goes on");

// FILE: required.mjs
import "./waits.mjs";
console.log("required runs");
export const value = 1;

// FILE: requires.mjs
import "./awaits.mjs";
console.log("requires goes on");
try {
  console.log(Object.keys(require("./required.mjs")).join());
} catch (error) {
  console.log("require() throws a", error.name);
}

// FILE: waits.mjs
import "./awaits.mjs";
console.log("waits goes on");

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="Promise" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Promise) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="all"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(PromiseAll) flags=[IsExpected]}
// CHECK-NEXT: v5 = ImportModule module=[[m_1]] referrer=[[m_0]]
// CHECK-NEXT: v6 = ImportModule module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: v7 = NewArray v5, v6 contents=undefined|null|Promise<undefined|null|object>
// CHECK-NEXT: v8 = Call v4, v2, v7 calleeKey="all" calleeName="Promise.all"
// CHECK-NEXT: v9 = PropGet v8 key="then"
// CHECK-NEXT: v10 = NewClosure function=[[f_3]]
// CHECK-NEXT: v11 = Call v9, v8, v10 calleeKey="then" calleeName="then"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="both are imported"
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v7 = ImportModule module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: v8 = PropGet v7 key="then"
// CHECK-NEXT: v9 = NewClosure function=[[f_5]]
// CHECK-NEXT: v10 = Call v8, v7, v9 calleeKey="then" calleeName="then"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="required is imported:"
// CHECK-NEXT: v7 = Builtin builtin=Object
// CHECK-NEXT: v8 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v9 = Call v8, v7, v0 calleeName="Object.keys"
// CHECK-NEXT: v10 = PropGet v9 key="join"
// CHECK-NEXT: v11 = Call v10, v9 calleeKey="join" calleeName="join"
// CHECK-NEXT: v12 = Call v5, v3, v6, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v12
// CHECK-NEXT: }
