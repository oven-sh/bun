// RUN: lower
// OPTIONS: builtin-modules

// The parameter of catch (e) has a scope of its own, and the declarations of a sloppy direct eval pass it (ECMA-262 B.3.4).
module.exports = {};

function show(label, run) {
  try {
    console.log(label, run());
  } catch (error) {
    console.log(label, "throws", error.name);
  }
}

function declaresWithoutValue() {
  try {
    throw 1;
  } catch (e) {
    eval("var e");
    return e;
  }
}
show("var without a value", declaresWithoutValue);

function declaresInFunction() {
  try {
    throw 1;
  } catch (e) {
    eval("var e = 2");
  }
  return [typeof e, e];
}
show("the variable belongs to the function", declaresInFunction);

function declaresFunction() {
  let inside;
  try {
    throw 1;
  } catch (e) {
    eval("function e() { return 3 }");
    inside = typeof e;
  }
  return [inside, typeof e, e()];
}
show("function declaration", declaresFunction);

function readsAndStores() {
  try {
    throw 1;
  } catch (e) {
    const read = eval("e");
    eval("e += 10");
    return [read, e];
  }
}
show("read and store", readsAndStores);

function deletes() {
  try {
    throw 1;
  } catch (e) {
    return [eval("delete e"), e];
  }
}
show("delete", deletes);

function createAccessors() {
  try {
    throw 1;
  } catch (e) {
    return { set: eval("(function (value) { e = value })"), get: () => e };
  }
}
const accessors = createAccessors();
accessors.set(5);
show("closure stores after return", () => accessors.get());

function nests() {
  try {
    throw 1;
  } catch (e) {
    let inner;
    try {
      throw 2;
    } catch (e) {
      eval("var e = 3");
      inner = e;
    }
    return [inner, e];
  }
}
show("nested catch", nests);

function storesUnderWith() {
  const object = { e: 5 };
  try {
    throw 1;
  } catch (e) {
    with (object) {
      eval("var e = 6");
    }
    return [object.e, e];
  }
}
show("with inside catch", storesUnderWith);

function catchesUnderWith() {
  const object = { e: 5 };
  with (object) {
    try {
      throw 1;
    } catch (e) {
      eval("var e = 6");
      return [object.e, e];
    }
  }
}
show("catch inside with", catchesUnderWith);

function readsOuterNames(parameter) {
  let local = 2;
  try {
    throw 1;
  } catch (e) {
    return eval("local += e; [parameter, local, typeof show, typeof missing]");
  }
}
show("names outside the catch", () => readsOuterNames(7));

function redeclaresBlockLet() {
  try {
    throw 1;
  } catch (e) {
    let x = 1;
    eval("var x = 2");
    return x;
  }
}
show("var over let in the block of the catch", redeclaresBlockLet);

function redeclaresArrayPattern() {
  try {
    throw [1];
  } catch ([e]) {
    eval("var e = 2");
    return e;
  }
}
show("var over a destructured parameter", redeclaresArrayPattern);

function redeclaresInForOf() {
  try {
    throw 1;
  } catch (e) {
    eval("for (var e of [2]);");
    return e;
  }
}
show("for (var e of ..)", redeclaresInForOf);

try {
  throw 1;
} catch (e) {
  console.log("outside any function", eval("e += 1; e"), e);
}
show("nothing on the global object", () => typeof globalThis.e);

// GENERATED: redeclaresInForOf get
// CHECK-LABEL: function {{*}}name="redeclaresInForOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] captures=[{type=object flags=[IsFromCompiler] variableName="arguments"}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: object, v1: object, v2: anything, v3: function, v4: anything, v5: int[0, 4294967295], v6: Array):
// CHECK-NEXT: v7 = CreateMappedArguments v3, v5, v6
// CHECK-NEXT: v8 = ToThis v2
// CHECK-NEXT: v9 = NewObject layout=[[L_1]]
// CHECK-NEXT: v10 = Null
// CHECK-NEXT: SetLiteralPrototype v9, v10
// CHECK-NEXT: v12 = FinishObject v9
// CHECK-NEXT: v13 = NewObject -, v7 layout=[[L_2]] fields=[0]
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v14 = Integer integer=1
// CHECK-NEXT: Throw v14
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = NewObject layout=[[L_3]]
// CHECK-NEXT: PutEnvironmentField v16, v15 layout=[[L_3]]
// CHECK-NEXT: v18 = ScopeHasBinding v12 key="eval"
// CHECK-NEXT: Branch v18 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Jump -> next b7(v12, v19)
// CHECK-NEXT: b4():
// CHECK-NEXT: v20 = ScopeHasBinding v1 key="eval"
// CHECK-NEXT: Branch v20 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Jump -> next b7(v1, v21)
// CHECK-NEXT: b6():
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Jump -> next b7(v22, v22)
// CHECK-NEXT: b7(v23, v24):
// CHECK-NEXT: v25 = TypeTest v23 testedType=object
// CHECK-NEXT: Branch v25 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v26):
// CHECK-NEXT: v27 = PropGet v26 key="eval"
// CHECK-NEXT: Jump -> next b10(v27)
// CHECK-NEXT: b9(v28):
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="eval" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b10(v31)
// CHECK-NEXT: b10(v32):
// CHECK-NEXT: v33 = String string="for (var e of [2]);"
// CHECK-NEXT: v34 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v35 = StrictEq v32, v34
// CHECK-NEXT: Branch v35 -> taken b11(), notTaken b12(| 0)
// CHECK-NEXT: b11():
// CHECK-NEXT: v36 = DirectEval v33, v8, v4, v16, v12, v13, v1, v0 evalScope=e14
// CHECK-NEXT: Jump -> next b13(v36)
// CHECK-NEXT: b12(v37):
// CHECK-NEXT: v38 = Call v37, v24, v33 calleeName="eval"
// CHECK-NEXT: Jump -> next b13(v38)
// CHECK-NEXT: b13(v39):
// CHECK-NEXT: v40 = GetEnvironmentField v16 layout=[[L_3]]
// CHECK-NEXT: Return v40
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=env [[L_4]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_4]]):
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
