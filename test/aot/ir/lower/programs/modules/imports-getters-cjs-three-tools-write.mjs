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
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
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
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v1 = TypeTest v0 testedType=absent
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = ThrowModuleFailure failure=q0
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v6 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: v8 = ThrowModuleFailure failure=q1
// CHECK-NEXT: Unreachable
// CHECK-NEXT: b4(v9):
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="typescript"
// CHECK-NEXT: v7 = Call v6 calleeName="typescript"
// CHECK-NEXT: v8 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v9 = CheckInitialized v8 name="babel"
// CHECK-NEXT: v10 = Call v9 calleeName="babel"
// CHECK-NEXT: v11 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v12 = CheckInitialized v11 name="swc"
// CHECK-NEXT: v13 = Call v12 calleeName="swc"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v15 = CheckInitialized v14 name="above"
// CHECK-NEXT: v16 = Call v15 calleeName="above"
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="read"
// CHECK-NEXT: v19 = Call v18 calleeName="read"
// CHECK-NEXT: v20 = Call v19
// CHECK-NEXT: v21 = Call v4, v2, v7, v10, v13, v16, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
