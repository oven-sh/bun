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
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v12 key="errors"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v17 = Call v5 calleeName="framework"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="router"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[L_9]] flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="get"
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v23 = String string="/"
// CHECK-NEXT: v24 = NewClosure function=[[f_10]]
// CHECK-NEXT: v25 = Call v22, v20, v23, v24 calleeKey="get" calleeName="app.router.get"
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="console" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v28 key="log"
// CHECK-NEXT: v30 = Convert v29 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v31 = PropGet v18 key="handle"
// CHECK-NEXT: v32 = Convert v31 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v33 = String string="GET"
// CHECK-NEXT: v34 = String string="/"
// CHECK-NEXT: v35 = Call v32, v18, v33, v34 calleeKey="handle" calleeName="app.handle"
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v37 = Call v30, v28, v36 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v38 = Builtin builtin=GlobalThis
// CHECK-NEXT: v39 = PropGet v38 key="console" [isFreeName]
// CHECK-NEXT: v40 = Convert v39 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v41 = PropGet v40 key="log"
// CHECK-NEXT: v42 = Convert v41 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v43 = PropGet v18 key="handle"
// CHECK-NEXT: v44 = Convert v43 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v45 = String string="GET"
// CHECK-NEXT: v46 = String string="/missing"
// CHECK-NEXT: v47 = Call v44, v18, v45, v46 calleeKey="handle" calleeName="app.handle"
// CHECK-NEXT: v48 = Convert v47 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v49 = Call v42, v40, v48 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v50 = Builtin builtin=GlobalThis
// CHECK-NEXT: v51 = PropGet v50 key="console" [isFreeName]
// CHECK-NEXT: v52 = Convert v51 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v53 = PropGet v52 key="log"
// CHECK-NEXT: v54 = Convert v53 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v55 = PropGet v18 key="router"
// CHECK-NEXT: v56 = InstanceOf v55, v14 writtenExpression="app.router instanceof Router"
// CHECK-NEXT: v57 = PropGet v5 key="errors"
// CHECK-NEXT: v58 = StrictEq v16, v57
// CHECK-NEXT: v59 = PropGet v5 key="created"
// CHECK-NEXT: v60 = Call v59, v5 calleeKey="created" calleeName="framework.created"
// CHECK-NEXT: v61 = Call v54, v52, v56, v58, v60 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v62 = Undefined
// CHECK-NEXT: Return v62
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
