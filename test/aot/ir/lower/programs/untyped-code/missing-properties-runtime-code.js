// RUN: lower
// OPTIONS: builtin-modules

// Functions made at run time read properties that are not there, over and over, while the objects and their prototype chains change under them.
const lines = [];
const collect = typeof gc === "function" ? gc : () => Bun.gc(true);
const readers = Object.create(null);
const reader = name => (readers[name] ??= new Function("value", "return value." + name + ";"));
const numeric = new Function("value", "return value['0.5'];"), negativeZero = new Function("value", "return value['-0'];");
const defaults = new Function("{ first = 'one', second, third = second } = {}", "return first + ' ' + second + ' ' + third;");
const show = value => (typeof value === "function" ? "function" : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));
const say = (label, run) => {
  const seen = [];
  for (let turn = 0; turn < 6; turn++) {
    try {
      seen.push(show(run()));
    } catch (error) {
      seen.push("throws " + error.constructor.name);
    }
  }
  lines.push(label + ": " + seen.join(" "));
};

say("an empty object", () => reader("absent")({}));
say("defaults", () => defaults());
say("defaults of an empty object", () => defaults({}));
say("defaults given", () => defaults({ second: 2 }));

const plain = { a: 1 };
say("before it is added", () => reader("later")(plain));
plain.later = "added";
say("after it is added", () => reader("later")(plain));
delete plain.later;
say("after it is deleted", () => reader("later")(plain));

const root = {}, make = () => Object.create(root);
say("before the root has it", () => reader("onTheRoot")(make()));
root.onTheRoot = "inherited";
say("while it has it", () => reader("onTheRoot")(make()));
delete root.onTheRoot;
say("after it lost it", () => reader("onTheRoot")(make()));
Object.defineProperty(root, "onTheRoot", { get() { return "got by " + typeof this; }, configurable: true });
say("while it has a getter", () => reader("onTheRoot")(make()));
delete root.onTheRoot;
say("after the getter went", () => reader("onTheRoot")(make()));

class Base {}
class Derived extends Base {}
const instance = new Derived();
say("an instance", () => reader("method")(instance));
Base.prototype.method = "of the base";
say("the base class has it", () => reader("method")(instance));
Derived.prototype.method = "of the derived";
say("the derived class has it", () => reader("method")(instance));
delete Derived.prototype.method;
delete Base.prototype.method;
say("neither has it", () => reader("method")(instance));
Object.setPrototypeOf(Derived.prototype, { method: "of a new parent" });
say("the chain is another", () => reader("method")(instance));
Object.setPrototypeOf(instance, null);
say("no chain at all", () => reader("method")(instance));

const bare = Object.create(null);
say("no prototype", () => reader("toString")(bare));
const behindProxy = Object.create(new Proxy({}, { get: (target, key) => "trapped " + String(key), has: () => true }));
say("a proxy in the chain", () => reader("anything")(behindProxy));
let traps = 0;
const counting = Object.create(new Proxy({}, { get() { traps++; return undefined; } }));
say("a proxy that answers undefined", () => reader("counted")(counting));
lines.push("traps " + traps);
say("a proxy itself", () => reader("absent")(new Proxy({}, {})));

say("a string", () => reader("absent")("text"));
say("a number", () => reader("absent")(5));
say("a boolean", () => reader("absent")(true));
say("a symbol", () => reader("absent")(Symbol.iterator));
say("a bigint", () => reader("absent")(5n));
say("undefined", () => reader("absent")(undefined));
say("null", () => reader("absent")(null));

say("an array", () => reader("absent")([1, 2]));
say("a function", () => reader("absent")(() => 1));
say("arguments", () => reader("absent")((function () { return arguments; })(1)));
say("a typed array", () => reader("absent")(new Uint8Array(2)));
say("a typed array and a number as a name", () => numeric(new Uint8Array(2)));
class Bytes extends Uint8Array {}
Bytes.prototype["0.5"] = "half";
Bytes.prototype["-0"] = "negative zero";
Bytes.prototype.named = "a name";
say("a typed array stops the search for a number", () => numeric(new Bytes(2)) + " " + negativeZero(new Bytes(2)) + " " + reader("named")(new Bytes(2)));
say("an object does not", () => numeric(Object.create(Bytes.prototype)) + " " + negativeZero(Object.create(Bytes.prototype)));
say("a map", () => reader("absent")(new Map()));
say("a regular expression", () => reader("absent")(/x/));
say("a date", () => reader("absent")(new Date(0)));
say("the global object", () => reader("absentFromTheGlobalObject")(globalThis));
globalThis.absentFromTheGlobalObject = "now a global";
say("the global object has it", () => reader("absentFromTheGlobalObject")(globalThis));
delete globalThis.absentFromTheGlobalObject;
say("the global object lost it", () => reader("absentFromTheGlobalObject")(globalThis));

const dictionary = {};
for (let i = 0; i < 200; i++) dictionary["key" + i] = i;
for (let i = 0; i < 200; i += 2) delete dictionary["key" + i];
say("a dictionary", () => reader("key2")(dictionary) + " " + reader("key3")(dictionary));
dictionary.key2 = "back";
say("a dictionary gets it back", () => reader("key2")(dictionary));
const dictionaryParent = {};
for (let i = 0; i < 200; i++) dictionaryParent["key" + i] = i;
for (let i = 0; i < 200; i++) delete dictionaryParent["key" + i];
const child = Object.create(dictionaryParent);
say("a dictionary in the chain", () => reader("inParent")(child));
dictionaryParent.inParent = "found";
say("it gets the name", () => reader("inParent")(child));
delete dictionaryParent.inParent;
say("it loses the name", () => reader("inParent")(child));

const shapes = [{}, { a: 1 }, { b: 2 }, { a: 1, b: 2 }, { wanted: "here" }, Object.create({ wanted: "inherited" }), [], () => 1, "s"];
for (let round = 0; round < 4; round++) lines.push("many shapes: " + shapes.map(shape => show(reader("wanted")(shape))).join(" "));

let total = 0;
for (let turn = 0; turn < 40000; turn++) {
  const value = turn % 100 === 99 ? { seldom: turn } : make();
  const seen = reader("seldom")(value);
  total += seen === undefined ? 1 : seen;
  if (turn === 20000) {
    collect();
    root.seldom = 1000000;
  }
  if (turn === 20010) delete root.seldom;
}
lines.push("total " + total);
for (let round = 0; round < 3; round++) {
  for (let i = 0; i < 50; i++) {
    const once = new Function("value", "return value.absent" + i + ";");
    const shape = { ["own" + i + "x" + round]: 1 };
    for (let turn = 0; turn < 5; turn++) total += once(shape) === undefined ? 1 : 0;
  }
  collect();
}
lines.push("total " + total);
console.log(lines.join("\n"));

// GENERATED: Base reader make Derived has
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="reader"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="readers"
// CHECK-NEXT: v3 = TypeTest v0 testedType=object
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = RequireObjectCoercible v2 nullishAccess=Update
// CHECK-NEXT: v6 = ToPropertyKey v4
// CHECK-NEXT: Jump -> next b4(v6)
// CHECK-NEXT: b3(v7):
// CHECK-NEXT: Jump -> next b4(v7)
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: v9 = ElemGet v2, v8{{*}} callers
// CHECK-NEXT: v10 = TypeTest v9 testedType=undefined|null
// CHECK-NEXT: Branch v10 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v11):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="Function" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: v15 = String string="value"
// CHECK-NEXT: v16 = String string="return value."
// CHECK-NEXT: v17 = Add v16, v0
// CHECK-NEXT: v18 = String string=";"
// CHECK-NEXT: v19 = Add v17, v18
// CHECK-NEXT: v20 = Construct v14, -, v15, v19 calleeName="Function"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: ElemSet v2, v8, v21
// CHECK-NEXT: Jump -> next b8(v21)
// CHECK-NEXT: b7(v23):
// CHECK-NEXT: Jump -> next b8(v23)
// CHECK-NEXT: b8(v24):
// CHECK-NEXT: Return v24
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="root"
// CHECK-NEXT: v4 = Call v1, v0, v3 calleeName="Object.create"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=true flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: v1 = Convert v0 declared={type=true flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
