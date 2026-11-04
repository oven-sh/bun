// RUN: lower
// OPTIONS: builtin-modules

// Many callers pass a check in the function and so does an lookalikes.
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  span() {
    return this.x - this.y;
  }
}

function total(list) {
  if (!Array.isArray(list)) return "not an array";
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function append(list) {
  if (!Array.isArray(list)) return "not an array";
  return list.push(1);
}

function low(n) {
  if (typeof n !== "number") return "not a number";
  return n & 255;
}

function reciprocal(n) {
  if (typeof n !== "number") return "not a number";
  return 1 / n;
}

function whole(n) {
  if (!Number.isInteger(n)) return "not an integer";
  return n | 0;
}

function span(point) {
  if (!(point instanceof Point)) return "not a point";
  return point.x - point.y;
}

function spanByMethod(point) {
  if (!(point instanceof Point)) return "not a point";
  return point.span();
}

function invoke(f) {
  if (typeof f !== "function") return "not a function";
  return f(1);
}

function shout(text) {
  if (typeof text !== "string") return "not a string";
  return text.toUpperCase() + text.length;
}

function keysOf(object) {
  if (typeof object !== "object") return "not an object";
  return Object.keys(object).join();
}

function nameOf(object) {
  if (!object || !("name" in object)) return "no name";
  return object.name.length;
}

function firstOf(list) {
  if (list.length === 0) return "empty";
  return list[0];
}

function honest(round) {
  console.log(round, total([1, 2, 3]), total([]), total(new Array(4, 5)), append([1]), append([]), append(new Array(1, 2)));
  console.log(round, low(1), low(256), low(-1), reciprocal(2), reciprocal(4), reciprocal(0.5), whole(1), whole(7), whole(-3));
  console.log(round, span(new Point(3, 1)), span(new Point(0.5, 0.25)), spanByMethod(new Point(3, 1)), spanByMethod(new Point(9, 4)));
  console.log(round, invoke(v => v + 1), invoke(function (v) { return v * 2; }), shout("abc"), shout(""), shout(round));
  console.log(round, keysOf({ a: 1 }), keysOf({ b: 1, c: 2 }), nameOf({ name: "ann" }), nameOf({ name: "" }), firstOf([1]), firstOf([]), firstOf([2, 3]));
}

honest("before");
attempt("total of a subclass with its own iterator", () => total(new (class extends Array { [Symbol.iterator]() { return [][Symbol.iterator](); } })(1, 2)));
attempt("total of a proxy of an array", () => total(new Proxy([1, 2], { get: (target, key) => (log.push(String(key)), target[key]) })));
attempt("total of holes", () => total(new Array(2)));
attempt("total of strings", () => total(["1", "2"]));
attempt("total of an array with a getter for an element", () => total(Object.defineProperty([1, 2], 1, { get: () => (log.push("get 1"), 5) })));
attempt("total of an array without a prototype", () => total(Object.setPrototypeOf([1, 2], null)));
attempt("total of an array of another realm", () => total(require("node:vm").runInNewContext("[1, 2]")));
attempt("append to a subclass", () => append(new (class extends Array { push() { return "the subclass's"; } })()));
attempt("append to an array with its own push", () => append(Object.assign([], { push: () => "its own" })));
attempt("append to a frozen array", () => append(Object.freeze([])));
attempt("append to an array without a prototype", () => append(Object.setPrototypeOf([], null)));
attempt("append to a proxy of an array", () => append(new Proxy([], { set: (target, key, value) => (log.push("set " + String(key)), Reflect.set(target, key, value)) })));
attempt("append to an array whose length cannot change", () => append(Object.defineProperty([], "length", { writable: false })));
for (const n of [2147483648, 4294967297, 1.5, -0, NaN, Infinity, -Infinity, 1e21, 2 ** 53]) {
  attempt("low of " + show(n), () => low(n));
  attempt("reciprocal of " + show(n), () => reciprocal(n));
  attempt("whole of " + show(n), () => whole(n));
}
attempt("span of a point whose x was deleted", () => { const point = new Point(3, 1); delete point.x; return span(point); });
attempt("span of a point with strings", () => span(new Point("3", "1")));
attempt("span of a point made without the constructor", () => span(Object.create(Point.prototype)));
attempt("span of an object moved under Point", () => span(Object.setPrototypeOf({ y: 1, x: 3, z: 0 }, Point.prototype)));
attempt("span of a point whose x became a getter", () => span(Object.defineProperty(new Point(3, 1), "x", { get: () => (log.push("get x"), 10) })));
attempt("span of a subclass with accessors", () => span(new (class extends Point { get y() { return 100; } set y(value) {} })(3, 1)));
attempt("span of a proxy of a point", () => span(new Proxy(new Point(3, 1), { get: (target, key) => (log.push(String(key)), 7) })));
attempt("span of an array moved under Point", () => span(Object.setPrototypeOf([3, 1], Point.prototype)));
attempt("spanByMethod of a point with its own span", () => spanByMethod(Object.assign(new Point(3, 1), { span: () => "its own" })));
attempt("spanByMethod of a subclass", () => spanByMethod(new (class extends Point { span() { return "the subclass's"; } })(3, 1)));
attempt("spanByMethod of a point whose span is a number", () => spanByMethod(Object.assign(new Point(3, 1), { span: 5 })));
attempt("invoke of a class", () => invoke(class {}));
attempt("invoke of a callable proxy", () => invoke(new Proxy(() => {}, { apply: () => "trapped" })));
attempt("invoke of a revoked proxy", () => { const { proxy, revoke } = Proxy.revocable(() => {}, {}); revoke(); return invoke(proxy); });
attempt("invoke of a bound function", () => invoke(((a, b) => [a, b]).bind(null, 0)));
attempt("invoke of an async function", () => invoke(async v => v));
attempt("invoke of a generator function", () => invoke(function* (v) { yield v; }));
attempt("shout of a String object", () => shout(new String("abc")));
attempt("shout of a long rope", () => shout("ab".repeat(3) + "c"));
attempt("shout of a string with a lone surrogate", () => shout("\ud800").length);
attempt("keysOf null", () => keysOf(null));
attempt("keysOf an array", () => keysOf([1, 2]));
attempt("keysOf a proxy", () => keysOf(new Proxy({ a: 1 }, { ownKeys: () => (log.push("ownKeys"), ["a"]) })));
attempt("nameOf an object whose name is undefined", () => nameOf({ name: undefined }));
attempt("nameOf an object whose name is a number", () => nameOf({ name: 5 }));
attempt("nameOf a function", () => nameOf(function named() {}));
attempt("nameOf a proxy that claims a name", () => nameOf(new Proxy({}, { has: () => true })));
attempt("nameOf a string", () => nameOf("text"));
attempt("firstOf a string", () => firstOf("ab"));
attempt("firstOf an object with a length", () => firstOf({ length: 3 }));
attempt("firstOf a function", () => firstOf(function (a) {}));
attempt("firstOf an object whose length is a getter", () => firstOf({ get length() { log.push("length"); return 1; }, get 0() { log.push("0"); return "first"; } }));
honest("after");

// GENERATED: whole spanByMethod [Symbol.iterator] set has
// CHECK-LABEL: function {{*}}name="whole"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=i32 flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: i32):
// CHECK-NEXT: v1 = Builtin builtin=Number
// CHECK-NEXT: v2 = Builtin builtin=NumberIsInteger
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Number.isInteger"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = BitOr v0, v6
// CHECK-NEXT: Return v7
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = String string="not an integer"
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="spanByMethod"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Point"
// CHECK-NEXT: v3 = InstanceOf v0, v2
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = PropGet v0 key="span"
// CHECK-NEXT: v7 = Call v6, v0 calleeKey="span" calleeName="point.span"
// CHECK-NEXT: Return v7
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: v9 = String string="not a point"
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Data data=[[d_3]]
// CHECK-NEXT: v1 = PropGet v0 key=@@iterator
// CHECK-NEXT: v2 = Call v1, v0 calleeKey=@@iterator
// CHECK-NEXT: ReturnCall v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] length=3 thisType={type=anything} parameters=[{type=undefined|null|Array<never> flags=[IsExpected]}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<never>, v1: undefined|null|string|symbol, v2: anything):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="log"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = String string="set "
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v7, -, v1 calleeName="String"
// CHECK-NEXT: v9 = Add v6, v8
// CHECK-NEXT: v10 = Call v5, v4, v9 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v11 = Builtin builtin=Reflect
// CHECK-NEXT: v12 = Builtin builtin=ReflectSet
// CHECK-NEXT: v13 = Call v12, v11, v0, v1, v2 calleeName="Reflect.set"
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
