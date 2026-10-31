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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasNewTarget, TakesCallee, HasArgumentCount, HasHiddenRest, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}, {type=object flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: object, v2: object, v3: anything, v4: function, v5: anything, v6: int[0, 4294967295], v7: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v8 = CreateMappedArguments v4, v6, v7
// CHECK-NEXT: v9 = ToThis v3
// CHECK-NEXT: v10 = NewObject layout=[[L_3]]
// CHECK-NEXT: v11 = Null
// CHECK-NEXT: SetLiteralPrototype v10, v11
// CHECK-NEXT: v13 = FinishObject v10
// CHECK-NEXT: v14 = NewObject -, v8 layout=[[L_4]] fields=[0]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v15 = Integer integer=1
// CHECK-NEXT: Throw v15
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v16 = CatchValue
// CHECK-NEXT: v17 = NewObject layout=[[L_5]]
// CHECK-NEXT: PutEnvironmentField v17, v16 layout=[[L_5]]
// CHECK-NEXT: v19 = ScopeHasBinding v13 key="eval"
// CHECK-NEXT: Branch v19 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v20 = Undefined
// CHECK-NEXT: Jump -> next b8(v13, v20)
// CHECK-NEXT: b5():
// CHECK-NEXT: v21 = ScopeHasBinding v2 key="eval"
// CHECK-NEXT: Branch v21 -> taken b6(), notTaken b7()
// CHECK-NEXT: b6():
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Jump -> next b8(v2, v22)
// CHECK-NEXT: b7():
// CHECK-NEXT: v23 = Undefined
// CHECK-NEXT: Jump -> next b8(v23, v23)
// CHECK-NEXT: b8(v24, v25):
// CHECK-NEXT: v26 = TypeTest v24 testedType=object
// CHECK-NEXT: Branch v26 -> taken b9(| 0), notTaken b10(| 0)
// CHECK-NEXT: b9(v27):
// CHECK-NEXT: v28 = PropGet v27 key="eval"
// CHECK-NEXT: Jump -> next b11(v28)
// CHECK-NEXT: b10(v29):
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="eval" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b11(v32)
// CHECK-NEXT: b11(v33):
// CHECK-NEXT: v34 = String string="for (var e of [2]);"
// CHECK-NEXT: v35 = Builtin builtin=Eval [isNotReadFromHolder]
// CHECK-NEXT: v36 = StrictEq v33, v35
// CHECK-NEXT: Branch v36 -> taken b12(), notTaken b13(| 0)
// CHECK-NEXT: b12():
// CHECK-NEXT: v37 = DirectEval v34, v9, v5, v17, v0, v13, v14, v2, v1 evalScope=e14
// CHECK-NEXT: Jump -> next b14(v37)
// CHECK-NEXT: b13(v38):
// CHECK-NEXT: v39 = Call v38, v25, v34 calleeName="eval"
// CHECK-NEXT: Jump -> next b14(v39)
// CHECK-NEXT: b14(v40):
// CHECK-NEXT: v41 = GetEnvironmentField v17 layout=[[L_5]]
// CHECK-NEXT: Return v41
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=env [[L_6]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: env [[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_6]]
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
