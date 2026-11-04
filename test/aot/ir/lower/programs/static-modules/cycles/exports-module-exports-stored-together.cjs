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
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Builtin builtin=GlobalThis
// CHECK-NEXT: v6 = PropGet v5 key="console" [isFreeName]
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key="log"
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_5]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v11 = Boolean boolean=true
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v13 = Call v4 calleeName="app"
// CHECK-NEXT: v14 = PropGet v13 key="router"
// CHECK-NEXT: v15 = PropGet v14 key="describe"
// CHECK-NEXT: v16 = Call v15, v14 calleeKey="describe" calleeName="describe"
// CHECK-NEXT: v17 = Call v4 calleeName="app"
// CHECK-NEXT: v18 = PropGet v17 key="version"
// CHECK-NEXT: v19 = Call v9, v7, v12, v16, v18 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
