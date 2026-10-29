// RUN: lower
// OPTIONS: builtin-modules

// A destructured name under `with` is resolved when its value is stored: after the read and the default, in an assignment and in a `var` alike.
function iterableThatRuns(effect) {
  return {
    [Symbol.iterator]() {
      return {
        next() {
          effect();
          return { value: "stored", done: false };
        },
        return() {
          return {};
        },
      };
    },
  };
}

function assignmentWhoseStepDeletes() {
  var a = "variable";
  var scope = { a: "property" };
  var iterable = iterableThatRuns(() => delete scope.a);
  with (scope) {
    [a] = iterable;
  }
  return scope.a + " " + a;
}
console.log("array assignment, the step deletes the property:", assignmentWhoseStepDeletes());

function declarationWhoseStepDeletes() {
  var scope = { a: "property" };
  var iterable = iterableThatRuns(() => delete scope.a);
  with (scope) {
    var [a] = iterable;
  }
  return scope.a + " " + a;
}
console.log("array declaration, the step deletes the property:", declarationWhoseStepDeletes());

function assignmentWhoseStepAdds() {
  var a = "variable";
  var scope = {};
  var iterable = iterableThatRuns(() => (scope.a = "property"));
  with (scope) {
    [a] = iterable;
  }
  return scope.a + " " + a;
}
console.log("array assignment, the step adds the property:", assignmentWhoseStepAdds());

function declarationWhoseStepAdds() {
  var scope = {};
  var iterable = iterableThatRuns(() => (scope.a = "property"));
  with (scope) {
    var [a] = iterable;
  }
  return scope.a + " " + a;
}
console.log("array declaration, the step adds the property:", declarationWhoseStepAdds());

function assignmentWhoseGetterDeletes() {
  var a = "variable";
  var scope = { a: "property" };
  var source = {
    get a() {
      delete scope.a;
      return "stored";
    },
  };
  with (scope) {
    ({ a } = source);
  }
  return scope.a + " " + a;
}
console.log("object assignment, the getter deletes the property:", assignmentWhoseGetterDeletes());

function declarationWhoseGetterDeletes() {
  var scope = { a: "property" };
  var source = {
    get a() {
      delete scope.a;
      return "stored";
    },
  };
  with (scope) {
    var { a } = source;
  }
  return scope.a + " " + a;
}
console.log("object declaration, the getter deletes the property:", declarationWhoseGetterDeletes());

function defaultAddsProperty() {
  var a = "variable";
  var holder = {};
  var scope = holder;
  with (scope) {
    [a = ((holder.a = "property"), "stored")] = [];
  }
  return holder.a + " " + a;
}
console.log("the default adds the property:", defaultAddsProperty());

function lookupFollowsRead() {
  var a;
  var order = [];
  var scope = new Proxy(
    {},
    {
      has(target, key) {
        if (key === "a") order.push("has a");
        return Reflect.has(target, key);
      },
    },
  );
  var source = {
    get a() {
      order.push("get a");
      return 1;
    },
  };
  with (scope) {
    ({ a } = source);
  }
  return order.join() + " " + a;
}
console.log("the lookup follows the read:", lookupFollowsRead());

function memberTargetComesFirst() {
  var order = [];
  var target = {};
  var scope = {
    get holder() {
      order.push("holder");
      return target;
    },
  };
  var iterable = iterableThatRuns(() => order.push("next"));
  with (scope) {
    [holder.a] = iterable;
  }
  return order.join() + " " + target.a;
}
console.log("the object of a member target comes before the step:", memberTargetComesFirst());

function loopHeadsStoreThroughScope() {
  var scope = { a: "property", b: "property" };
  with (scope) {
    for (var a of ["stored"]);
    for (var [b] of [["stored"]]);
  }
  return scope.a + " " + a + " " + scope.b + " " + b;
}
console.log("`var` in a loop head:", loopHeadsStoreThroughScope());

// GENERATED: declarationWhoseStepAdds has
// CHECK-LABEL: function {{*}}name="declarationWhoseStepAdds"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: v2 = Data data=[[d_2]]
// CHECK-NEXT: v3 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v4 = NewClosure v2 function=[[f_3]]
// CHECK-NEXT: v5 = Call v3, -, v4 calleeName="iterableThatRuns"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v7 = ToObject v2
// CHECK-NEXT: v8 = ScopeHasBinding v7 key="iterable"
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Jump -> next b4(v7, v7)
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Jump -> next b4(v9, v9)
// CHECK-NEXT: b4(v10, v11):
// CHECK-NEXT: v12 = TypeTest v10 testedType=object
// CHECK-NEXT: Branch v12 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v13):
// CHECK-NEXT: v14 = PropGet v13 key="iterable"
// CHECK-NEXT: Jump -> next b7(v14)
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: Jump -> next b7(v6)
// CHECK-NEXT: b7(v16):
// CHECK-NEXT: v17 = IteratorOpen v16 elementCount=1 [isDestructuring]
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8() handler=b17():
// CHECK-NEXT: v18 = IteratorResume v17 stepIndex=0
// CHECK-NEXT: v19 = ResultAt v18
// CHECK-NEXT: v20 = ResultAt v18 index=1
// CHECK-NEXT: v21 = ScopeHasBinding v7 key="a"
// CHECK-NEXT: Branch v21 -> taken b9(), notTaken b10()
// CHECK-NEXT: b9() handler=b17():
// CHECK-NEXT: Jump -> next b11(v7, v7)
// CHECK-NEXT: b10() handler=b17():
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Jump -> next b11(v22, v22)
// CHECK-NEXT: b11(v23, v24) handler=b17():
// CHECK-NEXT: v25 = TypeTest v23 testedType=object
// CHECK-NEXT: Branch v25 -> taken b12(| 0), notTaken b13(| 0)
// CHECK-NEXT: b12(v26) handler=b17():
// CHECK-NEXT: v27 = PropHas v26 key="a"
// CHECK-NEXT: PropSet v26, v20 key="a" mode=Sloppy
// CHECK-NEXT: Jump -> next b14(v1)
// CHECK-NEXT: b13(v29) handler=b17():
// CHECK-NEXT: Jump -> next b14(v20)
// CHECK-NEXT: b14(v30) handler=b17():
// CHECK-NEXT: Jump -> next b15()
// CHECK-NEXT: b15():
// CHECK-NEXT: IteratorClose v17
// CHECK-NEXT: Jump -> next b16()
// CHECK-NEXT: b16():
// CHECK-NEXT: v32 = PropGet v2 key="a"
// CHECK-NEXT: v33 = String string=" "
// CHECK-NEXT: v34 = Add v32, v33
// CHECK-NEXT: v35 = Add v34, v30
// CHECK-NEXT: v36 = Convert v35 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v36
// CHECK-NEXT: b17() role=IterationCleanup subject=v17:
// CHECK-NEXT: v37 = CatchException
// CHECK-NEXT: IteratorClose v17 completion=Throw
// CHECK-NEXT: Rethrow v37
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=undefined|null|Array flags=[IsExpected]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: anything, v2: undefined|null|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = String string="a"
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = PropGet v0 key="push"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="has a"
// CHECK-NEXT: v9 = Call v7, v0, v8 calleeKey="push" calleeName="order.push"
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b5(v11):
// CHECK-NEXT: v12 = Builtin builtin=Reflect
// CHECK-NEXT: v13 = Builtin builtin=ReflectHas
// CHECK-NEXT: v14 = Call v13, v12, v1, v11 calleeName="Reflect.has"
// CHECK-NEXT: v15 = Convert v14 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
