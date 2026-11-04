// RUN: lower
// OPTIONS: builtin-modules

// `with` in a CommonJS module: a name in the body resolves to a property of the object if the object has one at that moment, otherwise to the enclosing binding.
var outer = "outer";
var point = { x: 1, y: 2 };

with (point) {
  console.log("reads:", x, y, outer);
  x = 10;
  y += x;
  outer = "stored in the body";
}
console.log("stores:", point.x, point.y, outer, "x" in globalThis);

with (point) y = x * 2;
console.log("single statement:", point.y);
with (point) console.log("typeof:", typeof x, typeof missing);

function scale(vector, factor) {
  with (vector) {
    return [x * factor, y * factor].join();
  }
}
console.log("in a function:", scale(point, 3), "| a property shadows the parameter:", scale({ x: 1, y: 1, factor: 100 }, 3));

function addAndDelete() {
  var name = "variable";
  var scope = {};
  var seen = [];
  with (scope) {
    seen.push(name);
    scope.name = "property";
    seen.push(name);
    name = "stored";
    seen.push(scope.name);
    delete scope.name;
    seen.push(name);
  }
  return seen.join();
}
console.log("a property added and deleted in the body:", addAndDelete());

function declarations() {
  var holder = { value: "property", local: "property" };
  with (holder) {
    var value = "initializer";
    let local = "block scoped";
    var copy = local;
  }
  return [holder.value, String(value), copy, holder.local].join();
}
console.log("var initializer, let:", declarations());

function closure() {
  var counter = { count: 0 };
  var increment;
  with (counter) increment = () => ++count;
  increment();
  increment();
  return counter.count;
}
console.log("a closure created in the body:", closure());

function receiver() {
  var account = {
    balance: 5,
    read() {
      return this === account ? this.balance : "another receiver";
    },
  };
  with (account) return read();
}
console.log("this of a call by name:", receiver());

function unscopables() {
  var hidden = "variable";
  var keys = "variable";
  var scope = { hidden: "property", shown: "property", [Symbol.unscopables]: { hidden: true } };
  with (scope) var own = hidden + " " + shown;
  with ([1, 2]) var inherited = keys + " " + length + " " + typeof join;
  return own + " | " + inherited;
}
console.log("Symbol.unscopables:", unscopables());

function nested() {
  var first = { shared: "first", a: 1 };
  var second = { shared: "second", b: 2 };
  with (first) with (second) return [shared, a, b].join();
}
console.log("nested:", nested());

function objectConversion(value) {
  try {
    with (value) return typeof length;
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("ToObject:", objectConversion("text"), objectConversion(0), objectConversion(null), objectConversion(undefined));

function continueFromBody() {
  var totals = [];
  for (var item of [{ n: 1 }, { n: 2 }, { n: 3 }]) {
    with (item) {
      if (n === 2) continue;
      totals.push(n);
    }
  }
  return totals.join();
}
console.log("continue out of the body:", continueFromBody());

function throwFromBody() {
  var n = "variable";
  try {
    with ({ n: "property" }) throw n;
  } catch (thrown) {
    return thrown + ", then " + n;
  }
}
console.log("throw out of the body:", throwFromBody());

module.exports = { point };

// GENERATED: closure objectConversion read
// CHECK-LABEL: function {{*}}name="closure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v3 = ToObject v2
// CHECK-NEXT: v4 = ScopeHasBinding v3 key="increment"
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Jump -> next b4(v3, v3)
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Jump -> next b4(v5, v5)
// CHECK-NEXT: b4(v6, v7):
// CHECK-NEXT: v8 = NewClosure v3 function=[[f_3]]
// CHECK-NEXT: v9 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v9 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v10):
// CHECK-NEXT: v11 = PropHas v10 key="increment"
// CHECK-NEXT: PropSet v10, v8 key="increment" mode=Sloppy
// CHECK-NEXT: Jump -> next b7(v0)
// CHECK-NEXT: b6(v13):
// CHECK-NEXT: v14 = Convert v8 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b7(v14)
// CHECK-NEXT: b7(v15):
// CHECK-NEXT: v16 = Call v15 calleeName="increment"
// CHECK-NEXT: v17 = Call v15 calleeName="increment"
// CHECK-NEXT: v18 = PropGet v2 key="count"
// CHECK-NEXT: v19 = Convert v18 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="objectConversion"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b9():
// CHECK-NEXT: v1 = ToObject v0
// CHECK-NEXT: v2 = ScopeHasBinding v1 key="length"
// CHECK-NEXT: Branch v2 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3() handler=b9():
// CHECK-NEXT: Jump -> next b5(v1, v1)
// CHECK-NEXT: b4() handler=b9():
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Jump -> next b5(v3, v3)
// CHECK-NEXT: b5(v4, v5) handler=b9():
// CHECK-NEXT: v6 = TypeTest v4 testedType=object
// CHECK-NEXT: Branch v6 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v7) handler=b9():
// CHECK-NEXT: v8 = PropGet v7 key="length"
// CHECK-NEXT: Jump -> next b8(v8)
// CHECK-NEXT: b7(v9) handler=b9():
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="length" [isFreeName, isForTypeOf]
// CHECK-NEXT: Jump -> next b8(v11)
// CHECK-NEXT: b8(v12) handler=b9():
// CHECK-NEXT: v13 = TypeOf v12
// CHECK-NEXT: Return v13
// CHECK-NEXT: b9() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = PropGet v14 key="constructor"
// CHECK-NEXT: v16 = PropGet v15 key="name"
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasThis, HasExplicitName] captures=[{type=env [[L_5]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|number|"another receiver" flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: env [[L_5]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ToThis v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_5]]
// CHECK-NEXT: v5 = StrictEq v3, v4
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = Convert v2 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key="balance"
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b4(v8)
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = String string="another receiver"
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|number|"another receiver" flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
