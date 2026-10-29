// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 7

// FILE: main.mjs
// The getters as TypeScript, Babel and swc write them, over a function that its module replaces later, and a getter over an ES module that hands on a
// name which it imported through another getter.
import { greet as typescript } from "./typescript.cjs";
import { greet as babel } from "./babel.cjs";
import { greet as swc } from "./swc.cjs";
import { greet as above, read } from "./above.cjs";
import { change } from "./greeting.mjs";

function show() {
  console.log(typescript(), babel(), swc(), above(), read()());
}
show();
change();
show();

// FILE: above.cjs
var below_1 = require("./between.mjs");
Object.defineProperty(exports, "greet", { enumerable: true, get: function () { return below_1.greet; } });
exports.read = function () {
  return below_1.greet;
};

// FILE: babel.cjs
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "greet", {
  enumerable: true,
  get: function () {
    return _greeting.greet;
  }
});
var _greeting = require("./greeting.mjs");

// FILE: between.mjs
export { greet } from "./typescript.cjs";

// FILE: greeting.mjs
export let greet = function () {
  return "first";
};
export function change() {
  greet = function () {
    return "second";
  };
}

// FILE: swc.cjs
"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "greet", {
    enumerable: true,
    get: function() {
        return _greeting.greet;
    }
});
const _greeting = require("./greeting.mjs");

// FILE: typescript.cjs
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.greet = void 0;
var greeting_mjs_1 = require("./greeting.mjs");
Object.defineProperty(exports, "greet", { enumerable: true, get: function () { return greeting_mjs_1.greet; } });

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = Call v1 calleeName="show"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="change"
// CHECK-NEXT: v5 = Call v4 calleeName="change"
// CHECK-NEXT: v6 = Call v1 calleeName="show"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsHiddenInStackTraces] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = TypeTest v0 testedType=absent
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v2) frequency=Unlikely:
// CHECK-NEXT: v3 = ThrowModuleFailure failure=q0
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b3(v4):
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v6 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v7) frequency=Unlikely:
// CHECK-NEXT: v8 = ThrowModuleFailure failure=q1
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b5(v9):
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="typescript"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Call v7 calleeName="typescript"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v11 = CheckInitialized v10 name="babel"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v12 calleeName="babel"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v15 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v16 = CheckInitialized v15 name="swc"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v18 = Call v17 calleeName="swc"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v20 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v21 = CheckInitialized v20 name="above"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v23 = Call v22 calleeName="above"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v25 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v26 = CheckInitialized v25 name="read"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v28 = Call v27 calleeName="read"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v30 = Call v29
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v32 = Call v4, v2, v9, v14, v19, v24, v31 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v33 = Undefined
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
