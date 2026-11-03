// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.mjs
// A CommonJS file defines getters over variables that it declares further down, as compilers emit them, and then requires a file that requires an
// ES module with `export *` of it: the file is linked while it runs. Whoever imports a name holds what its getter answered at that moment,
// `undefined` where the getter threw.
import { early, fixed, loose, hoisted, made } from "./star.mjs";
import * as all from "./star.mjs";

function show(when) {
  console.log(when, typeof early, typeof fixed, typeof loose, typeof hoisted, typeof made);
  console.log(when, Object.keys(all).join(), typeof all.early, typeof all.fixed, typeof all.loose, typeof all.hoisted, typeof all.made);
}
show("now");
setTimeout(show, 0, "later");

// FILE: index.cjs
Object.defineProperty(exports, "early", { enumerable: true, get: function () { return _early; } });
Object.defineProperty(exports, "fixed", { enumerable: true, get: function () { return _fixed; } });
Object.defineProperty(exports, "loose", { enumerable: true, get: function () { return _loose; } });
Object.defineProperty(exports, "hoisted", { enumerable: true, get: function () { return _hoisted; } });
Object.defineProperty(exports, "made", { enumerable: true, get: function () { return made; } });
const _early = "early";
const _fixed = require("./inner.cjs");
let _loose = "loose";
var _hoisted = "hoisted";
function made() {}

// FILE: inner.cjs
exports.x = 1;
function read(object, name) {
  try {
    return typeof object[name];
  } catch (error) {
    return error.constructor.name;
  }
}
const names = ["early", "fixed", "loose", "hoisted", "made"];
console.log("required", names.map(name => read(require("./index.cjs"), name)).join());
const throughStar = require("./star.mjs");
console.log("through the star", Object.keys(throughStar).join(), names.map(name => read(throughStar, name)).join());

// FILE: star.mjs
export * from "./index.cjs";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: show
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="early"
// CHECK-NEXT: v8 = TypeOf v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="fixed"
// CHECK-NEXT: v11 = TypeOf v10
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="loose"
// CHECK-NEXT: v14 = TypeOf v13
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="hoisted"
// CHECK-NEXT: v17 = TypeOf v16
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v19 = CheckInitialized v18 name="made"
// CHECK-NEXT: v20 = TypeOf v19
// CHECK-NEXT: v21 = Call v5, v3, v0, v8, v11, v14, v17, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="console" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v24 key="log"
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v27 = Builtin builtin=Object
// CHECK-NEXT: v28 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v29 = ModuleNamespace module=[[m_7]]
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v31 = Call v28, v27, v30 calleeName="Object.keys"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="join"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v35 = Call v34, v32 calleeKey="join" calleeName="join"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v37 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v38 = CheckInitialized v37 name="early"
// CHECK-NEXT: v39 = Convert v38 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v40 = TypeOf v39
// CHECK-NEXT: v41 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v42 = TypeTest v41 testedType=absent
// CHECK-NEXT: Branch v42 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v43) frequency=Unlikely:
// CHECK-NEXT: v44 = ModuleNamespace module=[[m_7]]
// CHECK-NEXT: v45 = Convert v44 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v46 = PropGet v45 key="fixed"
// CHECK-NEXT: Jump -> next b4(v46)
// CHECK-NEXT: b3(v47):
// CHECK-NEXT: Jump -> next b4(v47)
// CHECK-NEXT: b4(v48):
// CHECK-NEXT: v49 = Convert v48 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v50 = TypeOf v49
// CHECK-NEXT: v51 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v52 = TypeTest v51 testedType=absent
// CHECK-NEXT: Branch v52 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v53) frequency=Unlikely:
// CHECK-NEXT: v54 = ModuleNamespace module=[[m_7]]
// CHECK-NEXT: v55 = Convert v54 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v56 = PropGet v55 key="loose"
// CHECK-NEXT: Jump -> next b7(v56)
// CHECK-NEXT: b6(v57):
// CHECK-NEXT: Jump -> next b7(v57)
// CHECK-NEXT: b7(v58):
// CHECK-NEXT: v59 = Convert v58 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v60 = TypeOf v59
// CHECK-NEXT: v61 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v62 = TypeTest v61 testedType=absent
// CHECK-NEXT: Branch v62 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v63) frequency=Unlikely:
// CHECK-NEXT: v64 = ModuleNamespace module=[[m_7]]
// CHECK-NEXT: v65 = Convert v64 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v66 = PropGet v65 key="hoisted"
// CHECK-NEXT: Jump -> next b10(v66)
// CHECK-NEXT: b9(v67):
// CHECK-NEXT: Jump -> next b10(v67)
// CHECK-NEXT: b10(v68):
// CHECK-NEXT: v69 = Convert v68 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v70 = TypeOf v69
// CHECK-NEXT: v71 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v72 = CheckInitialized v71 name="made"
// CHECK-NEXT: v73 = Convert v72 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v74 = TypeOf v73
// CHECK-NEXT: v75 = Call v26, v24, v0, v36, v40, v50, v60, v70, v74 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v76 = Undefined
// CHECK-NEXT: Return v76
// CHECK-NEXT: }
