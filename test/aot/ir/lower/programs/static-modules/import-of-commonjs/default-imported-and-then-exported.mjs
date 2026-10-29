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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = Builtin builtin=Object
// CHECK-NEXT: v6 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v7 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v6, v5, v8 calleeName="Object.keys"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="join"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v12, v10 calleeKey="join" calleeName="join"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v4, v2, v14 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v22 = CheckInitialized v21 name="old"
// CHECK-NEXT: v23 = TypeOf v22
// CHECK-NEXT: v24 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v25 = CheckInitialized v24 name="old"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="name"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|"old" flags=[IsExpected]}
// CHECK-NEXT: v29 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v30 = CheckInitialized v29 name="old"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="make"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v34 = Call v33, v31 calleeKey="make" calleeName="old.make"
// CHECK-NEXT: v35 = Convert v34 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v36 = PropGet v35 key="length"
// CHECK-NEXT: v37 = Convert v36 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v38 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v39 = CheckInitialized v38 name="old"
// CHECK-NEXT: v40 = Convert v39 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v41 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v42 = CheckInitialized v41 name="again"
// CHECK-NEXT: v43 = Convert v42 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v44 = StrictEq v40, v43
// CHECK-NEXT: v45 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v46 = TypeTest v45 testedType=absent
// CHECK-NEXT: Branch v46 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v47) frequency=Unlikely:
// CHECK-NEXT: v48 = ModuleNamespace module=[[m_1]]
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v50 = PropGet v49 key="old"
// CHECK-NEXT: Jump -> next b4(v50)
// CHECK-NEXT: b3(v51):
// CHECK-NEXT: Jump -> next b4(v51)
// CHECK-NEXT: b4(v52):
// CHECK-NEXT: v53 = Convert v52 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v54 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v55 = CheckInitialized v54 name="old"
// CHECK-NEXT: v56 = Convert v55 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v57 = StrictEq v53, v56
// CHECK-NEXT: v58 = Call v20, v18, v23, v28, v37, v44, v57 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v59 = Undefined
// CHECK-NEXT: Return v59
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
