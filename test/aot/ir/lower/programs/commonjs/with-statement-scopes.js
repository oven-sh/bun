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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = ToObject v1
// CHECK-NEXT: v3 = ScopeHasBinding v2 key="increment"
// CHECK-NEXT: Branch v3 -> taken b2(v2, v2), notTaken b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Jump -> next b2(v4, v4)
// CHECK-NEXT: b2(v5, v6):
// CHECK-NEXT: v7 = NewClosure v2 function=[[f_2]]
// CHECK-NEXT: v8 = TypeTest v5 testedType=object
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: v10 = PropHas v9 key="increment"
// CHECK-NEXT: PropSet v9, v7 key="increment" mode=Sloppy
// CHECK-NEXT: Jump -> next b5(v0)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = Convert v7 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5(v13)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: v15 = Call v14 calleeName="increment"
// CHECK-NEXT: v16 = Call v14 calleeName="increment"
// CHECK-NEXT: v17 = PropGet v1 key="count"
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="objectConversion"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b7():
// CHECK-NEXT: v1 = ToObject v0
// CHECK-NEXT: v2 = ScopeHasBinding v1 key="length"
// CHECK-NEXT: Branch v2 -> taken b3(v1, v1), notTaken b2()
// CHECK-NEXT: b2() handler=b7():
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Jump -> next b3(v3, v3)
// CHECK-NEXT: b3(v4, v5) handler=b7():
// CHECK-NEXT: v6 = TypeTest v4 testedType=object
// CHECK-NEXT: Branch v6 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v7) handler=b7():
// CHECK-NEXT: v8 = PropGet v7 key="length"
// CHECK-NEXT: Jump -> next b6(v8)
// CHECK-NEXT: b5(v9) handler=b7():
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="length" [isFreeName, isForTypeOf]
// CHECK-NEXT: Jump -> next b6(v11)
// CHECK-NEXT: b6(v12) handler=b7():
// CHECK-NEXT: v13 = TypeOf v12
// CHECK-NEXT: Return v13
// CHECK-NEXT: b7() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = PropGet v14 key="constructor"
// CHECK-NEXT: v16 = PropGet v15 key="name"
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasThis, HasExplicitName] captures=[{type=env [[L_4]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_4]], v1: anything):
// CHECK-NEXT: v2 = ToThis v1
// CHECK-NEXT: v3 = GetEnvironmentField v0 layout=[[L_4]]
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = PropGet v2 key="balance"
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = String string="another receiver"
// CHECK-NEXT: Jump -> next b3(v6)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
