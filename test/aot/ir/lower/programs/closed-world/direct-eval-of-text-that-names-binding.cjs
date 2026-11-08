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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
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
// CHECK-NEXT: v13 = GetEnvironmentField v6 layout=[[L_1]]
// CHECK-NEXT: Jump -> next b3(v13)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: v15 = Call v14, -, v10 calleeName="eval"
// CHECK-NEXT: Jump -> next b3(v15)
// CHECK-NEXT: b3(v16):
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="anotherFunctionUnderTheName"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
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
// CHECK-NEXT: b1() handler=b5():
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="eval" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v19 = String string="value"
// CHECK-NEXT: v20 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v21 = StrictEq v18, v20
// CHECK-NEXT: Branch v21 -> taken b3(v5), notTaken b2(| 0)
// CHECK-NEXT: b2(v22) handler=b5():
// CHECK-NEXT: v23 = Call v22, -, v19 calleeName="eval"
// CHECK-NEXT: Jump -> next b3(v23)
// CHECK-NEXT: b3(v24) handler=b5():
// CHECK-NEXT: Jump -> next b4(v24)
// CHECK-NEXT: b4(v25):
// CHECK-NEXT: v26 = Integer
// CHECK-NEXT: v27 = Undefined
// CHECK-NEXT: Jump -> next b6(v26, v25, v27)
// CHECK-NEXT: b5() role=CleanupHandler:
// CHECK-NEXT: v28 = CatchValue
// CHECK-NEXT: v29 = Integer integer=1
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Jump -> next b6(v29, v30, v28)
// CHECK-NEXT: b6(v31, v32, v33):
// CHECK-NEXT: v34 = Builtin builtin=GlobalThis
// CHECK-NEXT: v35 = PropGet v34 key="globalThis" [isFreeName]
// CHECK-NEXT: v36 = Convert v35 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: PropSet v36, v10 key="eval"
// CHECK-NEXT: Switch v31 cases=[0] -> case b7(), otherwise b8()
// CHECK-NEXT: b7():
// CHECK-NEXT: Return v32
// CHECK-NEXT: b8():
// CHECK-NEXT: Throw v33
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="declared"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=4
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Declared"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
