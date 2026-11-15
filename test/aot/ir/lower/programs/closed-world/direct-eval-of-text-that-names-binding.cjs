// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.cjs
// A direct eval of a text that names one binding.
"use strict";
// A direct eval whose text is known at the build and is nothing but the name of a binding reads that binding. A package that hides `require` from bundlers writes it so.
const inner = require("./inner.cjs");

function inquire(moduleName) {
  try {
    var mod = eval("quire".replace(/^/, "re"))(moduleName);
    if (mod && (mod.length || Object.keys(mod).length)) return mod;
  } catch (e) {}
  return null;
}
console.log("inquire:", typeof inquire("node:path").join, inquire("node:not-a-module"), eval("quire".replace(/^/, "re")) === require, eval("requir".replace(/$/, "e")) === require);

function kinds(parameter) {
  const constant = 1;
  let variable = 2;
  var old = 3;
  function declared() {
    return 4;
  }
  class Declared {}
  variable += 10;
  return [eval("parameter"), eval("constant"), eval("variable"), eval("old"), eval("declared")(), eval("Declared") === Declared, eval("kinds") === kinds, eval("inner") === inner].join();
}
console.log("kinds:", kinds(0));
console.log("of the module:", eval("module") === module, eval("exports") === exports, eval("__filename") === __filename, eval("__dirname") === __dirname);

function deadZone() {
  try {
    return eval("later");
  } catch (error) {
    return error.name;
  }
  let later = 1;
}
function shadowed(require) {
  return eval("require");
}
function innermost() {
  const name = "outer";
  {
    const name = "inner";
    return eval("name") + " " + (() => eval("name"))();
  }
}
function storedLater() {
  let value = "first";
  const read = () => eval("value");
  const before = read();
  value = "second";
  return before + " " + read();
}
console.log("dead zone:", deadZone(), "| shadowed:", shadowed("the parameter"), "| innermost:", innermost(), "| stored later:", storedLater());

function otherArguments() {
  const order = [];
  const value = "the value";
  const found = eval("value", order.push("second argument"));
  return found + " " + order.join();
}
console.log("other arguments:", otherArguments());

function anotherFunctionUnderTheName() {
  const value = "the binding";
  const original = globalThis.eval;
  globalThis.eval = text => "called with " + text;
  try {
    return eval("value");
  } finally {
    globalThis.eval = original;
  }
}
console.log("another function under the name:", anotherFunctionUnderTheName(), "| and back:", (value => eval("value"))("the binding"));
console.log("the files go on:", inner.twice(21));

// FILE: inner.cjs
module.exports = { twice: x => x * 2 };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: shadowed anotherFunctionUnderTheName declared Declared
// CHECK-LABEL: function {{*}}name="shadowed"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: int[0, 4294967295], v3: undefined|null|string, v4: Array):
// CHECK-NEXT: v5 = CreateUnmappedArguments v2, v4, v3
// CHECK-NEXT: v6 = NewObject -, v3 layout=[[L_1]] fields=[0]
// CHECK-NEXT: v7 = Builtin builtin=GlobalThis
// CHECK-NEXT: v8 = PropGet v7 key="eval" [isFreeName]
// CHECK-NEXT: v9 = Convert v8 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v10 = String string="require"
// CHECK-NEXT: v11 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v12 = StrictEq v9, v11
// CHECK-NEXT: Branch v12 -> taken b1(), notTaken b2(| 0)
// CHECK-NEXT: b1():
// CHECK-NEXT: CheckEvaluation
// CHECK-NEXT: v14 = GetEnvironmentField v6 layout=[[L_1]]
// CHECK-NEXT: Jump -> next b3(v14)
// CHECK-NEXT: b2(v15):
// CHECK-NEXT: v16 = Call v15, -, v10 calleeName="eval"
// CHECK-NEXT: Jump -> next b3(v16)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="anotherFunctionUnderTheName"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: int[0, 4294967295], v3: Array):
// CHECK-NEXT: v4 = CreateUnmappedArguments v2, v3
// CHECK-NEXT: v5 = String string="the binding"
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="globalThis" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="eval"
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="globalThis" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v14 = NewClosure function=[[f_2]]
// CHECK-NEXT: PropSet v13, v14 key="eval"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b6():
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="eval" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v19 = String string="value"
// CHECK-NEXT: v20 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v21 = StrictEq v18, v20
// CHECK-NEXT: Branch v21 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2() handler=b6():
// CHECK-NEXT: CheckEvaluation
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b3(v23) handler=b6():
// CHECK-NEXT: v24 = Call v23, -, v19 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v24)
// CHECK-NEXT: b4(v25) handler=b6():
// CHECK-NEXT: Jump -> next b5(v25)
// CHECK-NEXT: b5(v26):
// CHECK-NEXT: v27 = Integer
// CHECK-NEXT: v28 = Undefined
// CHECK-NEXT: Jump -> next b7(v27, v26, v28)
// CHECK-NEXT: b6() role=CleanupHandler:
// CHECK-NEXT: v29 = CatchValue
// CHECK-NEXT: v30 = Integer integer=1
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Jump -> next b7(v30, v31, v29)
// CHECK-NEXT: b7(v32, v33, v34):
// CHECK-NEXT: v35 = Builtin builtin=GlobalThis
// CHECK-NEXT: v36 = PropGet v35 key="globalThis" [isFreeName]
// CHECK-NEXT: v37 = Convert v36 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: PropSet v37, v10 key="eval"
// CHECK-NEXT: Switch v32 cases=[0] -> case b8(), otherwise b9()
// CHECK-NEXT: b8():
// CHECK-NEXT: Return v33
// CHECK-NEXT: b9():
// CHECK-NEXT: Throw v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="declared"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=4
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Declared"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
