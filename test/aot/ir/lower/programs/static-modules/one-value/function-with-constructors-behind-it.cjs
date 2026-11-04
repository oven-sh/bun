// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// A package whose export is one function, with members stored on `module.exports` behind it: two by name, which read each other, and more by a helper that gets the function as an argument and stores under computed names.
const createError = require("./create-error.cjs");
const { isHttpError, HttpError } = require("./create-error.cjs");
const missing = createError(404, "no such page");
console.log(typeof createError, createError.name, createError.length);
console.log(missing instanceof HttpError, missing instanceof createError.NotFound, isHttpError(missing), createError.isHttpError({}), missing.status, missing.message);
console.log(Object.keys(createError).join());
console.log(createError.HttpError === HttpError, createError[500] === createError.InternalServerError, createError.InternalServerError.name);

// FILE: create-error.cjs
"use strict";
module.exports = createError;
module.exports.HttpError = createHttpErrorConstructor();
module.exports.isHttpError = createIsHttpErrorFunction(module.exports.HttpError);
populateConstructorExports(module.exports, [404, 500], module.exports.HttpError);

function createError(status, message) {
  const Constructor = createError[status] || module.exports.HttpError;
  const error = new Constructor(message);
  error.status = status;
  return error;
}

function createHttpErrorConstructor() {
  function HttpError(message) {
    this.message = message;
  }
  HttpError.prototype = Object.create(Error.prototype, { constructor: { value: HttpError, writable: true, configurable: true } });
  return HttpError;
}

function createIsHttpErrorFunction(HttpError) {
  return function isHttpError(value) {
    return value instanceof HttpError;
  };
}

function populateConstructorExports(exports, codes, HttpError) {
  for (const code of codes) {
    const name = code === 404 ? "NotFound" : "InternalServerError";
    const Constructor = class extends HttpError {};
    Object.defineProperty(Constructor, "name", { value: name });
    exports[code] = Constructor;
    exports[name] = Constructor;
  }
}

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
// CHECK-NEXT: v9 = NewRuntimeError runtimeError=NotDestructurable name="isHttpError"
// CHECK-NEXT: Throw v9
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = PropGet v10 key="isHttpError"
// CHECK-NEXT: v12 = PropGet v10 key="HttpError"
// CHECK-NEXT: v13 = Integer integer=404
// CHECK-NEXT: v14 = String string="no such page"
// CHECK-NEXT: v15 = Call v4, -, v13, v14 calleeName="createError"
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = TypeOf v4
// CHECK-NEXT: v22 = PropGet v4 key="name"
// CHECK-NEXT: v23 = PropGet v4 key="length"
// CHECK-NEXT: v24 = Call v20, v18, v21, v22, v23 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="console" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="log"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v30 = InstanceOf v15, v12
// CHECK-NEXT: v31 = PropGet v4 key="NotFound"
// CHECK-NEXT: v32 = InstanceOf v15, v31
// CHECK-NEXT: v33 = Call v11, -, v15 calleeName="isHttpError"
// CHECK-NEXT: v34 = PropGet v4 key="isHttpError"
// CHECK-NEXT: v35 = Data data=[[d_5]]
// CHECK-NEXT: v36 = Call v34, v4, v35 calleeKey="isHttpError" calleeName="createError.isHttpError"
// CHECK-NEXT: v37 = PropGet v15 key="status"
// CHECK-NEXT: v38 = PropGet v15 key="message"
// CHECK-NEXT: v39 = Call v29, v27, v30, v32, v33, v36, v37, v38 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v40 = Builtin builtin=GlobalThis
// CHECK-NEXT: v41 = PropGet v40 key="console" [isFreeName]
// CHECK-NEXT: v42 = Convert v41 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v43 = PropGet v42 key="log"
// CHECK-NEXT: v44 = Convert v43 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v45 = Builtin builtin=Object
// CHECK-NEXT: v46 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v47 = Call v46, v45, v4 calleeName="Object.keys"
// CHECK-NEXT: v48 = PropGet v47 key="join"
// CHECK-NEXT: v49 = Call v48, v47 calleeKey="join" calleeName="join"
// CHECK-NEXT: v50 = Call v44, v42, v49 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v51 = Builtin builtin=GlobalThis
// CHECK-NEXT: v52 = PropGet v51 key="console" [isFreeName]
// CHECK-NEXT: v53 = Convert v52 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v54 = PropGet v53 key="log"
// CHECK-NEXT: v55 = Convert v54 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v56 = PropGet v4 key="HttpError"
// CHECK-NEXT: v57 = StrictEq v56, v12
// CHECK-NEXT: v58 = Integer integer=500
// CHECK-NEXT: v59 = ElemGet v4, v58
// CHECK-NEXT: v60 = PropGet v4 key="InternalServerError"
// CHECK-NEXT: v61 = StrictEq v59, v60
// CHECK-NEXT: v62 = PropGet v4 key="InternalServerError"
// CHECK-NEXT: v63 = PropGet v62 key="name"
// CHECK-NEXT: v64 = Call v55, v53, v57, v61, v63 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v65 = Undefined
// CHECK-NEXT: Return v65
// CHECK-NEXT: }
