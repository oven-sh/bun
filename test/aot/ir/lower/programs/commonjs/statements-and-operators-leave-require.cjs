// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 29

// FILE: main.cjs
// Whether a file is sloppy or strict when a statement or an operator never reaches its only `require`.
require("./conditional.js");
require("./and.js");
require("./or.js");
require("./nullish.js");
require("./else.js");
require("./while.js");
require("./for.js");
require("./switch.js");
require("./behind-return.js");
require("./behind-throw.js");
require("./nested-function.js");
require("./false-conditional.js");
require("./false-and.js");
require("./one-nullish.js");
require("./else-of-true.js");
require("./while-false.js");
require("./for-false.js");
require("./switch-on-a-number.js");
require("./switch-default.js");
require("./behind-plain-return.js");
require("./behind-plain-throw.js");
require("./behind-break.js");
require("./behind-continue.js");
require("./behind-labeled-break.js");
require("./behind-return-on-both-ways.js");
require("./function-never-called.js");
require("./test-names-require.js");
require("./test-names-require-in-a-function.js");

// FILE: and.js
typeof Bun === "undefined" && require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared53 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("and", typeOfThis(), storeToUndeclaredName());

// FILE: behind-break.js
for (;;) {
  break;
  require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared73 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-break", typeOfThis(), storeToUndeclaredName());

// FILE: behind-continue.js
for (let i = 0; i < 1; i++) {
  continue;
  require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared74 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-continue", typeOfThis(), storeToUndeclaredName());

// FILE: behind-labeled-break.js
a: {
  break a;
  require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared75 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-labeled-break", typeOfThis(), storeToUndeclaredName());

// FILE: behind-plain-return.js
function f() {
  return 1;
  require("node:path");
}
f();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared71 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-plain-return", typeOfThis(), storeToUndeclaredName());

// FILE: behind-plain-throw.js
try {
  throw 1;
  require("node:path");
} catch {}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared72 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-plain-throw", typeOfThis(), storeToUndeclaredName());

// FILE: behind-return-on-both-ways.js
function f(a) {
  if (a) return 1;
  else return 2;
  require("node:path");
}
f();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared76 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-return-on-both-ways", typeOfThis(), storeToUndeclaredName());

// FILE: behind-return.js
function f() {
  if (typeof Bun !== "undefined") return 1;
  return require("node:path");
}
f();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared60 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-return", typeOfThis(), storeToUndeclaredName());

// FILE: behind-throw.js
try {
  if (typeof Bun !== "undefined") throw 1;
  require("node:path");
} catch {}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared61 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("behind-throw", typeOfThis(), storeToUndeclaredName());

// FILE: conditional.js
typeof Bun === "undefined" ? require("node:path") : 0;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared52 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("conditional", typeOfThis(), storeToUndeclaredName());

// FILE: else-of-true.js
if (true) {
} else require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared66 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("else-of-true", typeOfThis(), storeToUndeclaredName());

// FILE: else.js
if (typeof Bun !== "undefined") {
} else require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared56 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("else", typeOfThis(), storeToUndeclaredName());

// FILE: false-and.js
false && require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared64 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("false-and", typeOfThis(), storeToUndeclaredName());

// FILE: false-conditional.js
false ? require("node:path") : 0;
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared63 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("false-conditional", typeOfThis(), storeToUndeclaredName());

// FILE: for-false.js
for (; false; ) require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared68 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("for-false", typeOfThis(), storeToUndeclaredName());

// FILE: for.js
for (; typeof Bun === "undefined"; ) require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared58 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("for", typeOfThis(), storeToUndeclaredName());

// FILE: function-never-called.js
function f() {
  require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared77 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("function-never-called", typeOfThis(), storeToUndeclaredName());

// FILE: nested-function.js
if (typeof Bun === "undefined") {
  (function () {
    module.exports = 1;
  })();
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared62 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("nested-function", typeOfThis(), storeToUndeclaredName());

// FILE: nullish.js
globalThis.Bun ?? require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared55 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("nullish", typeOfThis(), storeToUndeclaredName());

// FILE: one-nullish.js
1 ?? require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared65 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("one-nullish", typeOfThis(), storeToUndeclaredName());

// FILE: or.js
typeof Bun !== "undefined" || require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared54 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("or", typeOfThis(), storeToUndeclaredName());

// FILE: switch-default.js
switch (1) {
  case 1:
    break;
  default:
    require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared70 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("switch-default", typeOfThis(), storeToUndeclaredName());

// FILE: switch-on-a-number.js
switch (1) {
  case 2:
    require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared69 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("switch-on-a-number", typeOfThis(), storeToUndeclaredName());

// FILE: switch.js
switch (typeof Bun) {
  case "undefined":
    require("node:path");
}
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared59 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("switch", typeOfThis(), storeToUndeclaredName());

// FILE: test-names-require-in-a-function.js
function f() {
  if (typeof require === "undefined") console.log(1);
}
f();
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared79 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("test-names-require-in-a-function", typeOfThis(), storeToUndeclaredName());

// FILE: test-names-require.js
if (typeof require === "undefined") console.log(1);
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared78 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("test-names-require", typeOfThis(), storeToUndeclaredName());

// FILE: while-false.js
while (false) require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared67 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("while-false", typeOfThis(), storeToUndeclaredName());

// FILE: while.js
while (typeof Bun === "undefined") require("node:path");
function typeOfThis() {
  return typeof this;
}
function storeToUndeclaredName() {
  try {
    neverDeclared57 = 1;
    return "stored";
  } catch (error) {
    return error.name;
  }
}
console.log("while", typeOfThis(), storeToUndeclaredName());

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
// CHECK-NEXT: v4 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_4]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v6 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_5]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v8 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_6]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v10 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_7]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v12 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_8]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v14 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_9]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v16 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_10]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v18 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_11]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v20 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_12]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v22 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_13]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v24 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_14]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v26 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_15]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v28 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_16]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v30 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_17]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v32 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_18]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v34 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_19]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v36 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_20]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v38 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_21]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v40 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_22]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v42 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_23]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v44 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_24]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v46 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_25]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v48 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_26]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v50 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_27]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v52 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_28]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v54 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_29]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v56 = Boolean boolean=true
// CHECK-NEXT: EvaluateModule module=[[m_30]] referrer=[[m_0]] [isBare, isCallOfRequire]
// CHECK-NEXT: v58 = Boolean boolean=true
// CHECK-NEXT: v59 = Undefined
// CHECK-NEXT: Return v59
// CHECK-NEXT: }
