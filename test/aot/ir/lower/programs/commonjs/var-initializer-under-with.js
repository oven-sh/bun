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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = ToObject v1
// CHECK-NEXT: v3 = ScopeHasBinding v2 key="named"
// CHECK-NEXT: Branch v3 -> taken b2(v2, v2), notTaken b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Jump -> next b2(v4, v4)
// CHECK-NEXT: b2(v5, v6):
// CHECK-NEXT: v7 = NewClosure function=[[f_2]]
// CHECK-NEXT: v8 = TypeTest v5 testedType=object
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b4(v7)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: v10 = PropHas v9 key="named"
// CHECK-NEXT: PropSet v9, v7 key="named" mode=Sloppy
// CHECK-NEXT: Jump -> next b4(v0)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = PropGet v1 key="named"
// CHECK-NEXT: v14 = PropGet v13 key="name"
// CHECK-NEXT: v15 = String string=" "
// CHECK-NEXT: v16 = Add v14, v15
// CHECK-NEXT: v17 = Add v16, v12
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=anything variableName="order"}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: undefined|null|string|symbol):
// CHECK-NEXT: v3 = String string="x"
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = PropGet v0 key="push"
// CHECK-NEXT: v6 = String string="has x"
// CHECK-NEXT: v7 = Call v5, v0, v6 calleeKey="push" calleeName="order.push"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = Builtin builtin=Reflect
// CHECK-NEXT: v9 = Builtin builtin=ReflectHas
// CHECK-NEXT: v10 = Call v9, v8, v1, v2 calleeName="Reflect.has"
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
