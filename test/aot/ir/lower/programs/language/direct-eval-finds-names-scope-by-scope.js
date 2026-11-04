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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] length=1 captures=[{type=object flags=[IsFromCompiler] variableName="arguments"}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: object, v1: object, v2: anything, v3: function, v4: anything, v5: int[0, 4294967295], v6: undefined|null|string, v7: Array):
// CHECK-NEXT: v8 = CreateMappedArguments v3, v5, v7, v6
// CHECK-NEXT: v9 = ToThis v2
// CHECK-NEXT: v10 = NewObject layout=[[L_1]]
// CHECK-NEXT: v11 = Null
// CHECK-NEXT: SetLiteralPrototype v10, v11
// CHECK-NEXT: v13 = FinishObject v10
// CHECK-NEXT: v14 = NewObject -, v8 layout=[[L_2]] fields=[0]
// CHECK-NEXT: v15 = ScopeHasBinding v13 key="eval"
// CHECK-NEXT: Branch v15 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: Jump -> next b5(v13, v16)
// CHECK-NEXT: b2():
// CHECK-NEXT: v17 = ScopeHasBinding v1 key="eval"
// CHECK-NEXT: Branch v17 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: Jump -> next b5(v1, v18)
// CHECK-NEXT: b4():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Jump -> next b5(v19, v19)
// CHECK-NEXT: b5(v20, v21):
// CHECK-NEXT: v22 = TypeTest v20 testedType=object
// CHECK-NEXT: Branch v22 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v23):
// CHECK-NEXT: v24 = PropGet v23 key="eval"
// CHECK-NEXT: Jump -> next b8(v24)
// CHECK-NEXT: b7(v25):
// CHECK-NEXT: v26 = Builtin builtin=GlobalThis
// CHECK-NEXT: v27 = PropGet v26 key="eval" [isFreeName]
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b8(v28)
// CHECK-NEXT: b8(v29):
// CHECK-NEXT: v30 = String string="shadowed"
// CHECK-NEXT: v31 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v32 = StrictEq v29, v31
// CHECK-NEXT: Branch v32 -> taken b9(), notTaken b10(| 0)
// CHECK-NEXT: b9():
// CHECK-NEXT: v33 = DirectEval v30, v9, v4, v8, v13, v14, v1, v0 evalScope=e5
// CHECK-NEXT: Jump -> next b11(v33)
// CHECK-NEXT: b10(v34):
// CHECK-NEXT: v35 = Call v34, v21, v30 calleeName="eval"
// CHECK-NEXT: Jump -> next b11(v35)
// CHECK-NEXT: b11(v36):
// CHECK-NEXT: Return v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_4]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
