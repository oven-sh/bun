// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 4

// FILE: main.cjs
// A small server framework in the form of hand-written npm packages: every module is one value, the entry has members behind it, and three files read them by name, by pattern and by call.
const framework = require("./framework/index.js");
const { Router, errors } = require("./framework/index.js");
const app = framework();
app.router.get("/", () => "home");
console.log(app.handle("GET", "/"));
console.log(app.handle("GET", "/missing"));
console.log(app.router instanceof Router, errors === framework.errors, framework.created());

// FILE: framework/errors.js
"use strict";
module.exports = createError;
module.exports.names = { 404: "NotFound" };

function createError(status) {
  return { status, name: createError.names[status] };
}

// FILE: framework/index.js
"use strict";
const Router = require("./router.js");
const errors = require("./errors.js");

let created = 1;

module.exports = framework;
module.exports.Router = Router;
module.exports.errors = errors;
module.exports.created = () => ++created - 0;

function framework() {
  const router = new Router();
  return {
    router,
    handle(method, path) {
      const handler = router.find(method, path);
      if (!handler) {
        const error = errors(404);
        return method + " " + path + " -> " + error.status + " " + error.name;
      }
      return method + " " + path + " -> " + handler();
    },
  };
}

// FILE: framework/router.js
"use strict";
module.exports = Router;

function Router() {
  this.routes = new Map();
}

for (const method of ["get", "post"]) {
  Router.prototype[method] = function (path, handler) {
    this.routes.set(method.toUpperCase() + " " + path, handler);
    return this;
  };
}

Router.prototype.find = function (method, path) {
  return this.routes.get(method + " " + path);
};

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
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v7 = TypeTest v6 testedType=undefined|null
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = NewRuntimeError runtimeError=NotDestructurable name="Router"
// CHECK-NEXT: Throw v9
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = PropGet v10 key="Router"
// CHECK-NEXT: v12 = PropGet v10 key="errors"
// CHECK-NEXT: v13 = Call v4 calleeName="framework"
// CHECK-NEXT: v14 = PropGet v13 key="router"
// CHECK-NEXT: v15 = PropGet v14 key="get"
// CHECK-NEXT: v16 = String string="/"
// CHECK-NEXT: v17 = NewClosure function=[[f_5]]
// CHECK-NEXT: v18 = Call v15, v14, v16, v17 calleeKey="get" calleeName="app.router.get"
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="console" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="log"
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v13 key="handle"
// CHECK-NEXT: v25 = String string="GET"
// CHECK-NEXT: v26 = String string="/"
// CHECK-NEXT: v27 = Call v24, v13, v25, v26 calleeKey="handle" calleeName="app.handle"
// CHECK-NEXT: v28 = Call v23, v21, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="console" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="log"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v34 = PropGet v13 key="handle"
// CHECK-NEXT: v35 = String string="GET"
// CHECK-NEXT: v36 = String string="/missing"
// CHECK-NEXT: v37 = Call v34, v13, v35, v36 calleeKey="handle" calleeName="app.handle"
// CHECK-NEXT: v38 = Call v33, v31, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v39 = Builtin builtin=GlobalThis
// CHECK-NEXT: v40 = PropGet v39 key="console" [isFreeName]
// CHECK-NEXT: v41 = Convert v40 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v42 = PropGet v41 key="log"
// CHECK-NEXT: v43 = Convert v42 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v44 = PropGet v13 key="router"
// CHECK-NEXT: v45 = InstanceOf v44, v11
// CHECK-NEXT: v46 = PropGet v4 key="errors"
// CHECK-NEXT: v47 = StrictEq v12, v46
// CHECK-NEXT: v48 = PropGet v4 key="created"
// CHECK-NEXT: v49 = Call v48, v4 calleeKey="created" calleeName="framework.created"
// CHECK-NEXT: v50 = Call v43, v41, v45, v47, v49 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v51 = Undefined
// CHECK-NEXT: Return v51
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="home"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
