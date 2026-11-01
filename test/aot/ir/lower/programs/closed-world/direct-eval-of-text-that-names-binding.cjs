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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: anything, v3: int[0, 4294967295], v4: undefined|null|string, v5: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = CreateUnmappedArguments v3, v5, v4
// CHECK-NEXT: v7 = NewObject -, v4 layout=[[L_3]] fields=[0]
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="eval" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v11 = String string="require"
// CHECK-NEXT: v12 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v13 = StrictEq v10, v12
// CHECK-NEXT: Branch v13 -> taken b2(), notTaken b3(| 0)
// CHECK-NEXT: b2():
// CHECK-NEXT: v14 = GetEnvironmentField v7 layout=[[L_3]]
// CHECK-NEXT: Jump -> next b4(v14)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: v16 = Call v15, -, v11 calleeName="eval"
// CHECK-NEXT: Jump -> next b4(v16)
// CHECK-NEXT: b4(v17):
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="anotherFunctionUnderTheName"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasNewTarget, HasArgumentCount, HasHiddenRest, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: anything, v3: int[0, 4294967295], v4: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = CreateUnmappedArguments v3, v4
// CHECK-NEXT: v6 = String string="the binding"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|"the binding" flags=[IsExpected]}
// CHECK-NEXT: v8 = Builtin builtin=GlobalThis
// CHECK-NEXT: v9 = PropGet v8 key="globalThis" [isFreeName]
// CHECK-NEXT: v10 = Convert v9 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="eval"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v14 = Builtin builtin=GlobalThis
// CHECK-NEXT: v15 = PropGet v14 key="globalThis" [isFreeName]
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: v17 = NewClosure function=[[f_6]]
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v16, v18 key="eval"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b7():
// CHECK-NEXT: v20 = Builtin builtin=GlobalThis
// CHECK-NEXT: v21 = PropGet v20 key="eval" [isFreeName]
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v23 = String string="value"
// CHECK-NEXT: v24 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v25 = StrictEq v22, v24
// CHECK-NEXT: Branch v25 -> taken b3(), notTaken b4(| 0)
// CHECK-NEXT: b3() handler=b7():
// CHECK-NEXT: Jump -> next b5(v7)
// CHECK-NEXT: b4(v26) handler=b7():
// CHECK-NEXT: v27 = Call v26, -, v23 calleeName="eval"
// CHECK-NEXT: Jump -> next b5(v27)
// CHECK-NEXT: b5(v28) handler=b7():
// CHECK-NEXT: Jump -> next b6(v28)
// CHECK-NEXT: b6(v29):
// CHECK-NEXT: v30 = Integer
// CHECK-NEXT: v31 = Undefined
// CHECK-NEXT: Jump -> next b8(v30, v29, v31)
// CHECK-NEXT: b7() role=CleanupHandler:
// CHECK-NEXT: v32 = CatchValue
// CHECK-NEXT: v33 = Integer integer=1
// CHECK-NEXT: v34 = Undefined
// CHECK-NEXT: Jump -> next b8(v33, v34, v32)
// CHECK-NEXT: b8(v35, v36, v37):
// CHECK-NEXT: v38 = Builtin builtin=GlobalThis
// CHECK-NEXT: v39 = PropGet v38 key="globalThis" [isFreeName]
// CHECK-NEXT: v40 = Convert v39 declared={type=builtin(GlobalThis) flags=[IsExpected]}
// CHECK-NEXT: PropSet v40, v13 key="eval"
// CHECK-NEXT: Switch v35 cases=[0] -> case b9(), otherwise b10()
// CHECK-NEXT: b9():
// CHECK-NEXT: Return v36
// CHECK-NEXT: b10():
// CHECK-NEXT: Throw v37
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="declared"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=4
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Declared"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_8]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_8]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
