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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
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
// CHECK-NEXT: v34 = CheckInitialized v33 name="early"
// CHECK-NEXT: v35 = TypeOf v34
// CHECK-NEXT: v36 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v37 = TypeTest v36 testedType=absent
// CHECK-NEXT: Branch v37 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v38):
// CHECK-NEXT: v39 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v40 = PropGet v39 key="fixed"
// CHECK-NEXT: Jump -> next b3(v40)
// CHECK-NEXT: b2(v41):
// CHECK-NEXT: Jump -> next b3(v41)
// CHECK-NEXT: b3(v42):
// CHECK-NEXT: v43 = TypeOf v42
// CHECK-NEXT: v44 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v45 = TypeTest v44 testedType=absent
// CHECK-NEXT: Branch v45 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v46):
// CHECK-NEXT: v47 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v48 = PropGet v47 key="loose"
// CHECK-NEXT: Jump -> next b6(v48)
// CHECK-NEXT: b5(v49):
// CHECK-NEXT: Jump -> next b6(v49)
// CHECK-NEXT: b6(v50):
// CHECK-NEXT: v51 = TypeOf v50
// CHECK-NEXT: v52 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v53 = TypeTest v52 testedType=absent
// CHECK-NEXT: Branch v53 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v54):
// CHECK-NEXT: v55 = ModuleNamespace module=[[m_6]]
// CHECK-NEXT: v56 = PropGet v55 key="hoisted"
// CHECK-NEXT: Jump -> next b9(v56)
// CHECK-NEXT: b8(v57):
// CHECK-NEXT: Jump -> next b9(v57)
// CHECK-NEXT: b9(v58):
// CHECK-NEXT: v59 = TypeOf v58
// CHECK-NEXT: v60 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v61 = CheckInitialized v60 name="made"
// CHECK-NEXT: v62 = TypeOf v61
// CHECK-NEXT: v63 = Call v26, v24, v0, v32, v35, v43, v51, v59, v62 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v64 = Undefined
// CHECK-NEXT: Return v64
// CHECK-NEXT: }
