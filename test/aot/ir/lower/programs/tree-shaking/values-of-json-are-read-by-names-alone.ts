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
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="1.2.3"
// CHECK-NEXT: v6 = String string="!"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = String string="1.2.3"
// CHECK-NEXT: v9 = PropGet v8 key="length"
// CHECK-NEXT: v10 = Boolean boolean=true
// CHECK-NEXT: v11 = ToBoolean v10
// CHECK-NEXT: Branch v11 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v12):
// CHECK-NEXT: v13 = String string="on"
// CHECK-NEXT: Jump -> next b3(v13)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: v15 = String string="off"
// CHECK-NEXT: Jump -> next b3(v15)
// CHECK-NEXT: b3(v16):
// CHECK-NEXT: v17 = Null
// CHECK-NEXT: v18 = TypeTest v17 testedType=undefined|null
// CHECK-NEXT: Branch v18 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: v20 = String string="none"
// CHECK-NEXT: Jump -> next b6(v20)
// CHECK-NEXT: b5(v21):
// CHECK-NEXT: Jump -> next b6(v21)
// CHECK-NEXT: b6(v22):
// CHECK-NEXT: v23 = Integer integer=80
// CHECK-NEXT: v24 = Integer integer=1
// CHECK-NEXT: v25 = Add v23, v24
// CHECK-NEXT: v26 = Call v4, v2, v7, v9, v16, v22, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
