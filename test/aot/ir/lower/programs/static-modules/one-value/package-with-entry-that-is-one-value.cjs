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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = FinishObject v0
// CHECK-NEXT: PutModuleVariable v1 variable=[[g_2]]
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: EvaluateModule module=[[m_3]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v9 = TypeTest v8 testedType=undefined|null
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=NotDestructurable name="Router"
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = PropGet v12 key="Router"
// CHECK-NEXT: v14 = PropGet v12 key="errors"
// CHECK-NEXT: v15 = Call v5 calleeName="framework"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="router"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="get"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v21 = String string="/"
// CHECK-NEXT: v22 = NewClosure function=[[f_8]]
// CHECK-NEXT: v23 = Call v20, v18, v21, v22 calleeKey="get" calleeName="app.router.get"
// CHECK-NEXT: v24 = Builtin builtin=GlobalThis
// CHECK-NEXT: v25 = PropGet v24 key="console" [isFreeName]
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v26 key="log"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v16 key="handle"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v31 = String string="GET"
// CHECK-NEXT: v32 = String string="/"
// CHECK-NEXT: v33 = Call v30, v16, v31, v32 calleeKey="handle" calleeName="app.handle"
// CHECK-NEXT: v34 = Convert v33 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v35 = Call v28, v26, v34 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v36 = Builtin builtin=GlobalThis
// CHECK-NEXT: v37 = PropGet v36 key="console" [isFreeName]
// CHECK-NEXT: v38 = Convert v37 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v39 = PropGet v38 key="log"
// CHECK-NEXT: v40 = Convert v39 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v41 = PropGet v16 key="handle"
// CHECK-NEXT: v42 = Convert v41 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: v43 = String string="GET"
// CHECK-NEXT: v44 = String string="/missing"
// CHECK-NEXT: v45 = Call v42, v16, v43, v44 calleeKey="handle" calleeName="app.handle"
// CHECK-NEXT: v46 = Convert v45 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v47 = Call v40, v38, v46 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v48 = Builtin builtin=GlobalThis
// CHECK-NEXT: v49 = PropGet v48 key="console" [isFreeName]
// CHECK-NEXT: v50 = Convert v49 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v51 = PropGet v50 key="log"
// CHECK-NEXT: v52 = Convert v51 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v53 = PropGet v16 key="router"
// CHECK-NEXT: v54 = InstanceOf v53, v13 writtenExpression="app.router instanceof Router"
// CHECK-NEXT: v55 = PropGet v5 key="errors"
// CHECK-NEXT: v56 = StrictEq v14, v55
// CHECK-NEXT: v57 = PropGet v5 key="created"
// CHECK-NEXT: v58 = Call v57, v5 calleeKey="created" calleeName="framework.created"
// CHECK-NEXT: v59 = Call v52, v50, v54, v56, v58 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v60 = Undefined
// CHECK-NEXT: Return v60
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="home"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
