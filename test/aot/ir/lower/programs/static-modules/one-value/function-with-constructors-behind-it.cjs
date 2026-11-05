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
// CHECK-NEXT: v14 = PropGet v12 key="HttpError"
// CHECK-NEXT: v15 = Integer integer=404
// CHECK-NEXT: v16 = String string="no such page"
// CHECK-NEXT: v17 = Call v5, -, v15, v16 calleeName="createError"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v19 = Builtin builtin=GlobalThis
// CHECK-NEXT: v20 = PropGet v19 key="console" [isFreeName]
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="log"
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v24 = TypeOf v5
// CHECK-NEXT: v25 = PropGet v5 key="name"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v27 = PropGet v5 key="length"
// CHECK-NEXT: v28 = Convert v27 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v29 = Call v23, v21, v24, v26, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = InstanceOf v18, v14 writtenExpression="missing instanceof HttpError"
// CHECK-NEXT: v36 = PropGet v5 key="NotFound"
// CHECK-NEXT: v37 = InstanceOf v18, v36 writtenExpression="missing instanceof createError.NotFound"
// CHECK-NEXT: v38 = Call v13, -, v18 calleeName="isHttpError"
// CHECK-NEXT: v39 = PropGet v5 key="isHttpError"
// CHECK-NEXT: v40 = Data data=[[d_7]]
// CHECK-NEXT: v41 = Call v39, v5, v40 calleeKey="isHttpError" calleeName="createError.isHttpError"
// CHECK-NEXT: v42 = PropGet v18 key="status"
// CHECK-NEXT: v43 = PropGet v18 key="message"
// CHECK-NEXT: v44 = Call v34, v32, v35, v37, v38, v41, v42, v43 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v45 = Builtin builtin=GlobalThis
// CHECK-NEXT: v46 = PropGet v45 key="console" [isFreeName]
// CHECK-NEXT: v47 = Convert v46 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v48 = PropGet v47 key="log"
// CHECK-NEXT: v49 = Convert v48 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v50 = Builtin builtin=Object
// CHECK-NEXT: v51 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v52 = Call v51, v50, v5 calleeName="Object.keys"
// CHECK-NEXT: v53 = Convert v52 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v54 = PropGet v53 key="join"
// CHECK-NEXT: v55 = Convert v54 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v56 = Call v55, v53 calleeKey="join" calleeName="join"
// CHECK-NEXT: v57 = Convert v56 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v58 = Call v49, v47, v57 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v59 = Builtin builtin=GlobalThis
// CHECK-NEXT: v60 = PropGet v59 key="console" [isFreeName]
// CHECK-NEXT: v61 = Convert v60 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v62 = PropGet v61 key="log"
// CHECK-NEXT: v63 = Convert v62 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v64 = PropGet v5 key="HttpError"
// CHECK-NEXT: v65 = StrictEq v64, v14
// CHECK-NEXT: v66 = Integer integer=500
// CHECK-NEXT: v67 = ElemGet v5, v66
// CHECK-NEXT: v68 = PropGet v5 key="InternalServerError"
// CHECK-NEXT: v69 = StrictEq v67, v68
// CHECK-NEXT: v70 = PropGet v5 key="InternalServerError"
// CHECK-NEXT: v71 = PropGet v70 key="name"
// CHECK-NEXT: v72 = Call v63, v61, v65, v69, v71 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v73 = Undefined
// CHECK-NEXT: Return v73
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
