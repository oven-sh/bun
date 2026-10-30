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
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=NotDestructurable name="isHttpError"
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = PropGet v12 key="isHttpError"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v12 key="HttpError"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v17 = Integer integer=404
// CHECK-NEXT: v18 = String string="no such page"
// CHECK-NEXT: v19 = Call v5, -, v17, v18 calleeName="createError"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|number|string|symbol|bigint|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v21 = Builtin builtin=GlobalThis
// CHECK-NEXT: v22 = PropGet v21 key="console" [isFreeName]
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v23 key="log"
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v26 = TypeOf v5
// CHECK-NEXT: v27 = PropGet v5 key="name"
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v29 = PropGet v5 key="length"
// CHECK-NEXT: v30 = Convert v29 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v31 = Call v25, v23, v26, v28, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Builtin builtin=GlobalThis
// CHECK-NEXT: v33 = PropGet v32 key="console" [isFreeName]
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v35 = PropGet v34 key="log"
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v37 = InstanceOf v20, v16 writtenExpression="missing instanceof HttpError"
// CHECK-NEXT: v38 = PropGet v5 key="NotFound"
// CHECK-NEXT: v39 = InstanceOf v20, v38 writtenExpression="missing instanceof createError.NotFound"
// CHECK-NEXT: v40 = Call v14, -, v20 calleeName="isHttpError"
// CHECK-NEXT: v41 = Convert v40 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v42 = PropGet v5 key="isHttpError"
// CHECK-NEXT: v43 = Data data=[[d_9]]
// CHECK-NEXT: v44 = Call v42, v5, v43 calleeKey="isHttpError" calleeName="createError.isHttpError"
// CHECK-NEXT: v45 = PropGet v20 key="status"
// CHECK-NEXT: v46 = PropGet v20 key="message"
// CHECK-NEXT: v47 = Call v36, v34, v37, v39, v41, v44, v45, v46 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v48 = Builtin builtin=GlobalThis
// CHECK-NEXT: v49 = PropGet v48 key="console" [isFreeName]
// CHECK-NEXT: v50 = Convert v49 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v51 = PropGet v50 key="log"
// CHECK-NEXT: v52 = Convert v51 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v53 = Builtin builtin=Object
// CHECK-NEXT: v54 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v55 = Call v54, v53, v5 calleeName="Object.keys"
// CHECK-NEXT: v56 = Convert v55 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v57 = PropGet v56 key="join"
// CHECK-NEXT: v58 = Convert v57 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v59 = Call v58, v56 calleeKey="join" calleeName="join"
// CHECK-NEXT: v60 = Convert v59 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v61 = Call v52, v50, v60 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v62 = Builtin builtin=GlobalThis
// CHECK-NEXT: v63 = PropGet v62 key="console" [isFreeName]
// CHECK-NEXT: v64 = Convert v63 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v65 = PropGet v64 key="log"
// CHECK-NEXT: v66 = Convert v65 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v67 = PropGet v5 key="HttpError"
// CHECK-NEXT: v68 = StrictEq v67, v16
// CHECK-NEXT: v69 = Integer integer=500
// CHECK-NEXT: v70 = ElemGet v5, v69
// CHECK-NEXT: v71 = PropGet v5 key="InternalServerError"
// CHECK-NEXT: v72 = StrictEq v70, v71
// CHECK-NEXT: v73 = PropGet v5 key="InternalServerError"
// CHECK-NEXT: v74 = PropGet v73 key="name"
// CHECK-NEXT: v75 = Call v66, v64, v68, v72, v74 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v76 = Undefined
// CHECK-NEXT: Return v76
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
