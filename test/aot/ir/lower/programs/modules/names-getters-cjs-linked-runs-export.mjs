// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.mjs
// A CommonJS file defines getters over variables that it declares further down, as compilers emit them, and then requires a file that requires an
// ES module with `export *` of it: the file is linked while it runs. Whoever imports a name holds what its getter answered at that moment,
// `undefined` where the getter threw, until the file has ended and its names are read again.
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
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="early"
// CHECK-NEXT: v8 = TypeOf v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = CheckInitialized v9 name="fixed"
// CHECK-NEXT: v11 = TypeOf v10
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="loose"
// CHECK-NEXT: v14 = TypeOf v13
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="hoisted"
// CHECK-NEXT: v17 = TypeOf v16
// CHECK-NEXT: v18 = GetModuleVariable variable=[[g_5]]
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
// CHECK-NEXT: v29 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v30 = Call v28, v27, v29 calleeName="Object.keys"
// CHECK-NEXT: v31 = PropGet v30 key="join"
// CHECK-NEXT: v32 = Call v31, v30 calleeKey="join" calleeName="join"
// CHECK-NEXT: v33 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v34 = TypeTest v33 testedType=absent
// CHECK-NEXT: Branch v34 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v35):
// CHECK-NEXT: v36 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v37 = PropGet v36 key="early"
// CHECK-NEXT: Jump -> next b3(v37)
// CHECK-NEXT: b2(v38):
// CHECK-NEXT: Jump -> next b3(v38)
// CHECK-NEXT: b3(v39):
// CHECK-NEXT: v40 = TypeOf v39
// CHECK-NEXT: v41 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v42 = TypeTest v41 testedType=absent
// CHECK-NEXT: Branch v42 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v43):
// CHECK-NEXT: v44 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v45 = PropGet v44 key="fixed"
// CHECK-NEXT: Jump -> next b6(v45)
// CHECK-NEXT: b5(v46):
// CHECK-NEXT: Jump -> next b6(v46)
// CHECK-NEXT: b6(v47):
// CHECK-NEXT: v48 = TypeOf v47
// CHECK-NEXT: v49 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v50 = TypeTest v49 testedType=absent
// CHECK-NEXT: Branch v50 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v51):
// CHECK-NEXT: v52 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v53 = PropGet v52 key="loose"
// CHECK-NEXT: Jump -> next b9(v53)
// CHECK-NEXT: b8(v54):
// CHECK-NEXT: Jump -> next b9(v54)
// CHECK-NEXT: b9(v55):
// CHECK-NEXT: v56 = TypeOf v55
// CHECK-NEXT: v57 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v58 = TypeTest v57 testedType=absent
// CHECK-NEXT: Branch v58 -> taken b10(| 0), notTaken b11(| 0)
// CHECK-NEXT: b10(v59):
// CHECK-NEXT: v60 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v61 = PropGet v60 key="hoisted"
// CHECK-NEXT: Jump -> next b12(v61)
// CHECK-NEXT: b11(v62):
// CHECK-NEXT: Jump -> next b12(v62)
// CHECK-NEXT: b12(v63):
// CHECK-NEXT: v64 = TypeOf v63
// CHECK-NEXT: v65 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v66 = TypeTest v65 testedType=absent
// CHECK-NEXT: Branch v66 -> taken b13(| 0), notTaken b14(| 0)
// CHECK-NEXT: b13(v67):
// CHECK-NEXT: v68 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v69 = PropGet v68 key="made"
// CHECK-NEXT: Jump -> next b15(v69)
// CHECK-NEXT: b14(v70):
// CHECK-NEXT: Jump -> next b15(v70)
// CHECK-NEXT: b15(v71):
// CHECK-NEXT: v72 = TypeOf v71
// CHECK-NEXT: v73 = Call v26, v24, v0, v32, v40, v48, v56, v64, v72 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v74 = Undefined
// CHECK-NEXT: Return v74
// CHECK-NEXT: }
