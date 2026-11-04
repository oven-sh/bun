// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.mjs
import * as barrel from "./barrel.mjs";
import { old, again } from "./barrel.mjs";
console.log(Object.keys(barrel).join());
console.log(typeof old, old.name, old.make().length, old === again, barrel.old === old);

// FILE: barrel.mjs
import old from "./old.cjs";
export { old, old as again };

// FILE: old.cjs
exports.make = function () {
  return { length: 3, 0: 1 };
};
exports.name = "old";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=Object
// CHECK-NEXT: v6 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v7 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v8 = Call v6, v5, v7 calleeName="Object.keys"
// CHECK-NEXT: v9 = PropGet v8 key="join"
// CHECK-NEXT: v10 = Call v9, v8 calleeKey="join" calleeName="join"
// CHECK-NEXT: v11 = Call v4, v2, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="old"
// CHECK-NEXT: v19 = TypeOf v18
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="old"
// CHECK-NEXT: v22 = PropGet v21 key="name"
// CHECK-NEXT: v23 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v24 = CheckInitialized v23 name="old"
// CHECK-NEXT: v25 = PropGet v24 key="make"
// CHECK-NEXT: v26 = Call v25, v24 calleeKey="make" calleeName="old.make"
// CHECK-NEXT: v27 = PropGet v26 key="length"
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v29 = CheckInitialized v28 name="old"
// CHECK-NEXT: v30 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v31 = CheckInitialized v30 name="again"
// CHECK-NEXT: v32 = StrictEq v29, v31
// CHECK-NEXT: v33 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v34 = TypeTest v33 testedType=absent
// CHECK-NEXT: Branch v34 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v35):
// CHECK-NEXT: v36 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v37 = PropGet v36 key="old"
// CHECK-NEXT: Jump -> next b3(v37)
// CHECK-NEXT: b2(v38):
// CHECK-NEXT: Jump -> next b3(v38)
// CHECK-NEXT: b3(v39):
// CHECK-NEXT: v40 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v41 = CheckInitialized v40 name="old"
// CHECK-NEXT: v42 = StrictEq v39, v41
// CHECK-NEXT: v43 = Call v16, v14, v19, v22, v27, v32, v42 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v44 = Undefined
// CHECK-NEXT: Return v44
// CHECK-NEXT: }
