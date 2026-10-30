// RUN: lower
// OPTIONS: builtin-modules

// `var x = e` under `with` resolves `x` before it evaluates `e`, so an initializer that adds or deletes the property does not change where the value goes.
function initializerDeletesProperty() {
  var scope = { x: 0 };
  with (scope) {
    var x = (delete scope.x, 1);
  }
  return scope.x + " " + x;
}
console.log("initializer deletes the property:", initializerDeletesProperty());

function initializerAddsProperty() {
  var scope = {};
  with (scope) {
    var x = ((scope.x = 5), 1);
  }
  return scope.x + " " + x;
}
console.log("initializer adds the property:", initializerAddsProperty());

function initializerMovesProperty() {
  var outer = {};
  var inner = { x: "inner" };
  with (outer) {
    with (inner) {
      var x = (delete inner.x, (outer.x = "outer"), "stored");
    }
  }
  return outer.x + " " + inner.x + " " + x;
}
console.log("initializer moves the property to the outer object:", initializerMovesProperty());

function lookupComesFirst() {
  var order = [];
  var scope = new Proxy(
    {},
    {
      has(target, key) {
        if (key === "x") order.push("has x");
        return Reflect.has(target, key);
      },
    },
  );
  with (scope) {
    var x = order.push("initializer");
  }
  return order.join() + " " + x;
}
console.log("the lookup comes first:", lookupComesFirst());

function functionIsNamed() {
  var scope = { named: null };
  with (scope) {
    var named = function () {};
  }
  return scope.named.name + " " + named;
}
console.log("a function is named by the variable:", functionIsNamed());

// GENERATED: functionIsNamed has
// CHECK-LABEL: function {{*}}name="functionIsNamed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v3 = ToObject v2
// CHECK-NEXT: v4 = ScopeHasBinding v3 key="named"
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Jump -> next b4(v3, v3)
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Jump -> next b4(v5, v5)
// CHECK-NEXT: b4(v6, v7):
// CHECK-NEXT: v8 = NewClosure function=[[f_3]]
// CHECK-NEXT: v9 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v9 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v10):
// CHECK-NEXT: v11 = PropHas v10 key="named"
// CHECK-NEXT: PropSet v10, v8 key="named" mode=Sloppy
// CHECK-NEXT: Jump -> next b7(v0)
// CHECK-NEXT: b6(v13):
// CHECK-NEXT: v14 = Convert v8 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7(v14)
// CHECK-NEXT: b7(v15):
// CHECK-NEXT: v16 = PropGet v2 key="named"
// CHECK-NEXT: v17 = Convert v16 declared={type=null flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="name"
// CHECK-NEXT: v19 = String string=" "
// CHECK-NEXT: v20 = Add v18, v19
// CHECK-NEXT: v21 = Add v20, v15
// CHECK-NEXT: v22 = Convert v21 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=undefined|null|Array flags=[IsExpected]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: anything, v2: undefined|null|string|symbol):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = String string="x"
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = PropGet v0 key="push"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="has x"
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
