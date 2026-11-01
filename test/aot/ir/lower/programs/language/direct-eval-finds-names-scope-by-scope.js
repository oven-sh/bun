// RUN: lower
// OPTIONS: builtin-modules

// A name in the text of a direct eval is looked for scope by scope: the innermost declaration wins, the object of a `with` or a catch parameter between two scopes is asked in its turn, and a name that no scope has is the global object's.
module.exports = {};

let shadowed = "module";
let onlyInModule = "module only";
globalThis.onlyGlobal = "global";

function innermostWins(shadowed) {
  {
    let shadowed = "block";
    return [eval("shadowed"), eval("onlyInModule"), eval("onlyGlobal"), eval("typeof neverDeclared")];
  }
}
console.log(innermostWins("parameter"));

function parameterBeforeModule(shadowed) {
  return eval("shadowed");
}
console.log(parameterBeforeModule("parameter"), eval("shadowed"));

function withObjectBetween(shadowed, object) {
  with (object) {
    let inner = "inner";
    return [eval("shadowed"), eval("inner"), eval("onlyInModule")];
  }
}
console.log(withObjectBetween("parameter", {}));
console.log(withObjectBetween("parameter", { shadowed: "object" }));
console.log(withObjectBetween("parameter", { inner: "object", onlyInModule: "object" }));

function storesIntoInnermost(shadowed) {
  var block;
  {
    let shadowed = "block";
    eval("shadowed = 'stored'");
    block = shadowed;
  }
  return [block, shadowed];
}
console.log(storesIntoInnermost("parameter"), shadowed);

function catchParameterBetween(shadowed) {
  try {
    throw "caught";
  } catch (shadowed) {
    return [eval("shadowed"), eval("onlyInModule")];
  }
}
console.log(catchParameterBetween("parameter"));

function declaredByText(shadowed) {
  eval("var shadowed = 'declared by the text'; var fresh = 'fresh'");
  return [shadowed, eval("fresh"), typeof fresh];
}
console.log(declaredByText("parameter"));

function manyNames(a, b, c, d, e, f, g, h) {
  let i = 9, j = 10, k = 11, l = 12;
  return eval("[a, b, c, d, e, f, g, h, i, j, k, l].join()") + " " + eval("[l, k, j, i, h, g, f, e, d, c, b, a].join()");
}
console.log(manyNames(1, 2, 3, 4, 5, 6, 7, 8));

class Holder {
  #hidden = "private";
  read(hidden) {
    return [eval("this.#hidden"), eval("hidden")];
  }
}
console.log(new Holder().read("parameter"));

function closureKeepsScopes(shadowed) {
  let own = "own";
  return eval("() => [shadowed, own, onlyInModule, typeof neverDeclared]");
}
console.log(closureKeepsScopes("parameter")());

// GENERATED: parameterBeforeModule Holder
// CHECK-LABEL: function {{*}}name="parameterBeforeModule"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: object, v2: object, v3: anything, v4: function, v5: anything, v6: int[0, 4294967295], v7: undefined|null|string, v8: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v9 = CreateMappedArguments v4, v6, v8, v7
// CHECK-NEXT: v10 = ToThis v3
// CHECK-NEXT: v11 = NewObject layout=[[L_3]]
// CHECK-NEXT: v12 = Null
// CHECK-NEXT: SetLiteralPrototype v11, v12
// CHECK-NEXT: v14 = FinishObject v11
// CHECK-NEXT: v15 = NewObject -, v9 layout=[[L_4]] fields=[0]
// CHECK-NEXT: v16 = ScopeHasBinding v14 key="eval"
// CHECK-NEXT: Branch v16 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Jump -> next b6(v14, v17)
// CHECK-NEXT: b3():
// CHECK-NEXT: v18 = ScopeHasBinding v2 key="eval"
// CHECK-NEXT: Branch v18 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Jump -> next b6(v2, v19)
// CHECK-NEXT: b5():
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Jump -> next b6(v20, v20)
// CHECK-NEXT: b6(v21, v22):
// CHECK-NEXT: v23 = TypeTest v21 testedType=object
// CHECK-NEXT: Branch v23 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v24):
// CHECK-NEXT: v25 = PropGet v24 key="eval"
// CHECK-NEXT: Jump -> next b9(v25)
// CHECK-NEXT: b8(v26):
// CHECK-NEXT: v27 = Builtin builtin=GlobalThis
// CHECK-NEXT: v28 = PropGet v27 key="eval" [isFreeName]
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b9(v29)
// CHECK-NEXT: b9(v30):
// CHECK-NEXT: v31 = String string="shadowed"
// CHECK-NEXT: v32 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v33 = StrictEq v30, v32
// CHECK-NEXT: Branch v33 -> taken b10(), notTaken b11(| 0)
// CHECK-NEXT: b10():
// CHECK-NEXT: v34 = DirectEval v31, v10, v5, v9, v0, v14, v15, v2, v1 evalScope=e5
// CHECK-NEXT: Jump -> next b12(v34)
// CHECK-NEXT: b11(v35):
// CHECK-NEXT: v36 = Call v35, v22, v31 calleeName="eval"
// CHECK-NEXT: Jump -> next b12(v36)
// CHECK-NEXT: b12(v37):
// CHECK-NEXT: Return v37
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: classtoken, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v1 layout=[[L_6]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_6]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v0, v4 function=[[f_7]]
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
