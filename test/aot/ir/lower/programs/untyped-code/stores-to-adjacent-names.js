// RUN: lower
// OPTIONS: builtin-modules

// A class declares its fields and its constructor stores to them in the same order; a function sets an object back to its first state. The names are there already, one behind the other.
// What the objects hold afterwards, whatever has been done to them in between. Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const kFlags = Symbol("kFlags");
class State {
  highWaterMark;
  buffer;
  bufferIndex;
  length;
  pipes;
  flags;
  constructor(options) {
    const mark = options ? options.mark : 16;
    this.highWaterMark = mark;
    this.buffer = [];
    this.bufferIndex = 0;
    this.length = 0;
    this.pipes = [];
    this.flags = mark > 16 ? "large" : "small";
  }
}
function reset(object, value) {
  object.first = value;
  object.second = null;
  object[kFlags] = 0;
  object.third = "";
  object.fourth = false;
}
function resetNames(object, value) {
  object.first = value;
  object.second = null;
  object.third = "";
  object.fourth = false;
}
// Two functions are stored under the name: the callee is not known at the call and is not copied into the loop.
const holder = { resetNames: function Unused() {} };
holder.resetNames = resetNames;
function Made() {
  this.zero = 0;
  this.first = 1;
  this.second = 2;
  this.third = 3;
  this.fourth = 4;
  this.last = 5;
}
function describe(object) {
  if (Object(object) !== object) return String(object);
  return Reflect.ownKeys(object).map(key => String(key) + "=" + JSON.stringify(object[key])).join(" ");
}
function fresh() {
  return { zero: 0, first: 1, second: 2, [kFlags]: 3, third: 4, fourth: 5, last: 6 };
}

const said = new Set();
const counts = typeof aotOperationCount === "function";
for (let i = 0; i < 3000; i++) {
  said.add(describe(new State(i & 1 ? { mark: 32 } : null)));
  const object = fresh();
  reset(object, "set");
  said.add(describe(object));
  const literal = { zero: 0, first: 1, second: 2, third: 4, fourth: 5, last: 6 };
  holder.resetNames(literal, "set");
  said.add(describe(literal));
  const made = new Made();
  holder.resetNames(made, i & 1);
  said.add(describe(made));
}
const learnt = count("operationAOTTryPutProperties");
console.log([...said].join("\n"));
console.log(!counts || (learnt >= 1 && learnt <= 300) ? "the stores were learnt together" : "stores to names that lie in a row were learnt " + learnt + " times");

// The same function on objects that only look alike.
const log = [];
function tried(name, object) {
  let thrown = "";
  try {
    reset(object, name);
  } catch (error) {
    thrown = " " + error.constructor.name;
  }
  console.log(name + ": " + describe(object) + thrown + (log.length ? " | " + log.splice(0).join() : ""));
}
tried("another order", { zero: 0, second: 2, first: 1, [kFlags]: 3, third: 4, fourth: 5 });
tried("one is missing", { zero: 0, first: 1, second: 2, third: 4, fourth: 5 });
tried("none is there", {});
tried("something lies between", { first: 1, between: true, second: 2, [kFlags]: 3, third: 4, fourth: 5 });
const withSetter = fresh();
Object.defineProperty(withSetter, "second", { get() { return "got"; }, set(value) { log.push("second was set behind " + this.first + " and ahead of " + this.third); }, enumerable: true, configurable: true });
tried("a setter of its own", withSetter);
const readOnly = fresh();
Object.defineProperty(readOnly, "third", { writable: false });
tried("read-only", readOnly);
tried("frozen", Object.freeze(fresh()));
tried("sealed", Object.seal(fresh()));
tried("not extensible", Object.preventExtensions(fresh()));
const hidden = fresh();
Object.defineProperty(hidden, "fourth", { enumerable: false });
tried("not enumerable", hidden);
console.log(Object.keys(hidden).join());
const deleted = fresh();
delete deleted.second;
deleted.second = "again";
tried("deleted and added again", deleted);
const many = fresh();
for (let i = 0; i < 200; i++) many["more" + i] = i;
for (let i = 0; i < 200; i++) delete many["more" + i];
tried("a dictionary", many);
const parent = fresh();
tried("a prototype", parent);
const child = Object.create(parent);
tried("inherits them", child);
console.log(describe(parent));
const inheritsSetter = Object.create({ set third(value) { log.push("inherited setter " + value); } });
Object.assign(inheritsSetter, { first: 1, second: 2, [kFlags]: 3 });
tried("inherits a setter for one that is missing", inheritsSetter);
const shadows = Object.create({ set third(value) { log.push("never called"); } });
Object.defineProperties(shadows, Object.getOwnPropertyDescriptors(fresh()));
tried("shadows an inherited setter", shadows);
tried("an array", Object.assign([], fresh()));
tried("a function", Object.assign(function () {}, fresh()));
tried("a proxy", new Proxy(fresh(), { set(target, key, value) { log.push("set " + String(key)); target[key] = value; return true; } }));
for (const primitive of [1, "text", true, kFlags]) tried("a primitive", primitive);
for (const nothing of [null, undefined]) {
  try {
    reset(nothing, 1);
  } catch (error) {
    console.log(error.constructor.name);
  }
}

// A field that is defined twice is defined anew; a private name that is there already is refused.
class Returns {
  constructor(object) { return object; }
}
class Stamps extends Returns {
  a = 1;
  b = 2;
  c = 3;
}
class StampsPrivately extends Returns {
  #a = 1;
  #b = 2;
  #c = 3;
  static sum(object) { return object.#a + object.#b + object.#c; }
}
const stamped = {};
for (let i = 0; i < 40; i++) {
  new Stamps(stamped);
  stamped.b = "changed";
}
new Stamps(stamped);
console.log(describe(stamped));
const fixed = Object.defineProperty({ a: 0, b: 0, c: 0 }, "b", { writable: false, configurable: false });
try {
  new Stamps(fixed);
} catch (error) {
  console.log(error.constructor.name, describe(fixed));
}
let refused = 0;
for (let i = 0; i < 40; i++) {
  try {
    new StampsPrivately(stamped);
  } catch (error) {
    refused += error instanceof TypeError;
  }
}
console.log(refused, StampsPrivately.sum(stamped));

// GENERATED: reset describe Returns Stamps sum
// CHECK-LABEL: function {{*}}name="reset"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: PropSet v0, v1 key="first"
// CHECK-NEXT: v3 = Null
// CHECK-NEXT: PropSet v0, v3 key="second"
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v6 = CheckInitialized v5 name="kFlags"
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: ElemSet v0, v6, v7
// CHECK-NEXT: v9 = String string=""
// CHECK-NEXT: PropSet v0, v9 key="third"
// CHECK-NEXT: v11 = Boolean
// CHECK-NEXT: PropSet v0, v11 key="fourth"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Call v1, -, v0 calleeName="Object"
// CHECK-NEXT: v3 = StrictEq v2, v0
// CHECK-NEXT: Branch v3 -> taken b2(| 1), notTaken b4(| 1)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Builtin builtin=Reflect
// CHECK-NEXT: v6 = Builtin builtin=ReflectOwnKeys
// CHECK-NEXT: v7 = Call v6, v5, v4 calleeName="Reflect.ownKeys"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Array<undefined|null|string|symbol> flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="map"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v11 = NewClosure v4 function=[[f_4]]
// CHECK-NEXT: v12 = Call v10, v8, v11 calleeKey="map" calleeName="map"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v14 = PropGet v13 key="join"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v16 = String string=" "
// CHECK-NEXT: v17 = Call v15, v13, v16 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v17 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v19 = Builtin builtin=String
// CHECK-NEXT: v20 = Call v19, -, v18 calleeName="String"
// CHECK-NEXT: ReturnCall v20 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Returns"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_7]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = TypeTest v1 testedType=object
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b4(v6)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Stamps"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_9]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_10]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_13]] field=1
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v4 = PrivateGet v0, v3 layout=[[L_13]] field=2
// CHECK-NEXT: v5 = Add v2, v4
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v7 = PrivateGet v0, v6 layout=[[L_13]] field=3
// CHECK-NEXT: v8 = Add v5, v7
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
