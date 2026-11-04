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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = NewClosure v1 function=[[f_3]]
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="iterableThatRuns"
// CHECK-NEXT: v5 = ToObject v1
// CHECK-NEXT: v6 = ScopeHasBinding v5 key="iterable"
// CHECK-NEXT: Branch v6 -> taken b2(v5, v5), notTaken b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Jump -> next b2(v7, v7)
// CHECK-NEXT: b2(v8, v9):
// CHECK-NEXT: v10 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v10 -> taken b3(| 0), notTaken b4(v4)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = PropGet v11 key="iterable"
// CHECK-NEXT: Jump -> next b4(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = IteratorOpen v13 elementCount=1 [isDestructuring]
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b12():
// CHECK-NEXT: v15 = IteratorResume v14 stepIndex=0
// CHECK-NEXT: v16 = ResultAt v15
// CHECK-NEXT: v17 = ResultAt v15 index=1
// CHECK-NEXT: v18 = ScopeHasBinding v5 key="a"
// CHECK-NEXT: Branch v18 -> taken b7(v5, v5), notTaken b6()
// CHECK-NEXT: b6() handler=b12():
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: Jump -> next b7(v19, v19)
// CHECK-NEXT: b7(v20, v21) handler=b12():
// CHECK-NEXT: v22 = TypeTest v20 testedType=object
// CHECK-NEXT: Branch v22 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v23) handler=b12():
// CHECK-NEXT: v24 = PropHas v23 key="a"
// CHECK-NEXT: PropSet v23, v17 key="a" mode=Sloppy
// CHECK-NEXT: Jump -> next b10(v0)
// CHECK-NEXT: b9(v26) handler=b12():
// CHECK-NEXT: Jump -> next b10(v17)
// CHECK-NEXT: b10(v27) handler=b12():
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: IteratorClose v14
// CHECK-NEXT: v29 = PropGet v1 key="a"
// CHECK-NEXT: v30 = String string=" "
// CHECK-NEXT: v31 = Add v29, v30
// CHECK-NEXT: v32 = Add v31, v27
// CHECK-NEXT: Return v32
// CHECK-NEXT: b12() role=IterationCleanup subject=v14:
// CHECK-NEXT: v33 = CatchException
// CHECK-NEXT: IteratorClose v14 completion=Throw
// CHECK-NEXT: Rethrow v33
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=anything variableName="order"}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: undefined|null|string|symbol):
// CHECK-NEXT: v3 = String string="a"
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = PropGet v0 key="push"
// CHECK-NEXT: v6 = String string="has a"
// CHECK-NEXT: v7 = Call v5, v0, v6 calleeKey="push" calleeName="order.push"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = Builtin builtin=Reflect
// CHECK-NEXT: v9 = Builtin builtin=ReflectHas
// CHECK-NEXT: v10 = Call v9, v8, v1, v2 calleeName="Reflect.has"
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
