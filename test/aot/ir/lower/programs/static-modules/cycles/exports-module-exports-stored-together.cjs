// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 3

// FILE: main.cjs
// `exports = module.exports = createApplication` as the first statement, members stored through `exports` behind it, and a module in between that requires this one back.
const app = require("./app.cjs");
console.log(require("./router.cjs").saw, app().router.describe(), app().version);

// FILE: app.cjs
exports = module.exports = createApplication;
exports.version = "1";
const router = require("./router.cjs");
exports.Router = router.Router;
function createApplication() {
  return { router: new exports.Router(), version: exports.version };
}

// FILE: router.cjs
const app = require("./app.cjs");
exports.Router = class Router {
  describe() {
    return [typeof app, app.version, typeof app.Router].join();
  }
};
exports.saw = [typeof app, app.version, typeof app.Router].join();

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=CommonJsModule flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="console" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="log"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v12 = Boolean boolean=true
// CHECK-NEXT: v13 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v5 calleeName="app"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="router"
// CHECK-NEXT: v18 = PropGet v17 key="describe"
// CHECK-NEXT: v19 = Call v18, v17 calleeKey="describe" calleeName="describe"
// CHECK-NEXT: v20 = Call v5 calleeName="app"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="version"
// CHECK-NEXT: v23 = Call v10, v8, v14, v19, v22 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v24 = Undefined
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
