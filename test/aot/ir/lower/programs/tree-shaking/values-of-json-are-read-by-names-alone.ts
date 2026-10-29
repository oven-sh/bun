// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesData = 1

// FILE: main.ts
// Values of a json file are read by names alone.
import data, { version } from "./data.json";
console.log(
  data.version + "!",
  version.length,
  data.nested.deep.on ? "on" : "off",
  data.nested.deep.off ?? "none",
  data["nested"]["port"] + 1,
);

// FILE: data.json
{ "version": "1.2.3", "nested": { "port": 80, "deep": { "on": true, "off": null } }, "list": [1, 2, 3] }

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="1.2.3"
// CHECK-NEXT: v6 = String string="!"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = String string="1.2.3"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: v10 = PropGet v9 key="length"
// CHECK-NEXT: v11 = Convert v10 declared={type=number site=[[w_1]]} illTypedCause=Assertion
// CHECK-NEXT: v12 = Boolean boolean=true
// CHECK-NEXT: v13 = ToBoolean v12
// CHECK-NEXT: Branch v13 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v15 = String string="on"
// CHECK-NEXT: Jump -> next b6(v15)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v17 = String string="off"
// CHECK-NEXT: Jump -> next b6(v17)
// CHECK-NEXT: b6(v18):
// CHECK-NEXT: v19 = Null
// CHECK-NEXT: v20 = TypeTest v19 testedType=undefined|null
// CHECK-NEXT: Branch v20 -> taken b7(| 0), notTaken b9(| 0)
// CHECK-NEXT: b7(v21):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v22 = String string="none"
// CHECK-NEXT: Jump -> next b10(v22)
// CHECK-NEXT: b9(v23):
// CHECK-NEXT: Jump -> next b10(v23)
// CHECK-NEXT: b10(v24):
// CHECK-NEXT: v25 = Integer integer=80
// CHECK-NEXT: v26 = Integer integer=1
// CHECK-NEXT: v27 = Add v25, v26
// CHECK-NEXT: v28 = Call v4, v2, v7, v11, v18, v24, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
