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
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="reader"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="readers"
// CHECK-NEXT: v3 = RequireObjectCoercible v2 nullishAccess=Update
// CHECK-NEXT: v4 = TypeTest v0 testedType=object
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = ToPropertyKey v5
// CHECK-NEXT: Jump -> next b3(v6)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3(v7)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: v9 = ElemGet v2, v8
// CHECK-NEXT: v10 = TypeTest v9 testedType=undefined|null
// CHECK-NEXT: Branch v10 -> taken b4(| 0), notTaken b36(| 0)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="Function" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Function) flags=[IsExpected]}
// CHECK-NEXT: v15 = String string="value"
// CHECK-NEXT: v16 = String string="return value."
// CHECK-NEXT: v17 = Add v16, v0
// CHECK-NEXT: v18 = String string=";"
// CHECK-NEXT: v19 = Add v17, v18
// CHECK-NEXT: v20 = Builtin builtin=Function [isNotReadFromHolder]
// CHECK-NEXT: v21 = StrictEq v14, v20
// CHECK-NEXT: Branch v21 -> taken b5(), notTaken b34()
// CHECK-NEXT: b5():
// CHECK-NEXT: SwitchString v19 strings=["return value.absent;", "return value.later;", "return value.onTheRoot;", "return value.method;", "return value.toString;", "return value.anything;", "return value.counted;", "return value.named;", "return value.absentFromTheGlobalObject;", "return value.key2;", "return value.key3;", "return value.inParent;", "return value.wanted;", "return value.seldom;"] -> case b6(), case b8(), case b10(), case b12(), case b14(), case b16(), case b18(), case b20(), case b22(), case b24(), case b26(), case b28(), case b30(), case b32(), otherwise b34()
// CHECK-NEXT: b6():
// CHECK-NEXT: v22 = String string="value"
// CHECK-NEXT: v23 = StrictEq v15, v22
// CHECK-NEXT: Branch v23 -> taken b7(), notTaken b34()
// CHECK-NEXT: b7():
// CHECK-NEXT: CheckEvaluation [ofFunction]
// CHECK-NEXT: v25 = NewClosure function=[[f_4]]
// CHECK-NEXT: Jump -> next b35(v25)
// CHECK-NEXT: b8():
// CHECK-NEXT: v26 = String string="value"
// CHECK-NEXT: v27 = StrictEq v15, v26
// CHECK-NEXT: Branch v27 -> taken b9(), notTaken b34()
// CHECK-NEXT: b9():
// CHECK-NEXT: CheckEvaluation [ofFunction]
// CHECK-NEXT: v29 = NewClosure function=[[f_5]]
// CHECK-NEXT: Jump -> next b35(v29)
// CHECK-NEXT: b10():
// CHECK-NEXT: v30 = String string="value"
// CHECK-NEXT: v31 = StrictEq v15, v30
// CHECK-NEXT: Branch v31 -> taken b11(), notTaken b34()
// CHECK-NEXT: b11():
// CHECK-NEXT: CheckEvaluation [ofFunction]
// CHECK-NEXT: v33 = NewClosure function=[[f_6]]
// CHECK-NEXT: Jump -> next b35(v33)
// CHECK-NEXT: b12():
// CHECK-NEXT: v34 = String string="value"
// CHECK-NEXT: v35 = StrictEq v15, v34
// CHECK-NEXT: Branch v35 -> taken b13(), notTaken b34()
// CHECK-NEXT: b13():
// CHECK-NEXT: CheckEvaluation [ofFunction]
// CHECK-NEXT: v37 = NewClosure function=[[f_7]]
// CHECK-NEXT: Jump -> next b35(v37)
// CHECK-NEXT: b14():
// CHECK-NEXT: v38 = String string="value"
// CHECK-NEXT: v39 = StrictEq v15, v38
// CHECK-NEXT: Branch v39 -> taken b15(), notTaken b34()
// CHECK-NEXT: b15():
// CHECK-NEXT: CheckEvaluation [ofFunction]
// CHECK-NEXT: v41 = NewClosure function=[[f_8]]
// CHECK-NEXT: Jump -> next b35(v41)
// CHECK-NEXT: b16():
// CHECK-NEXT: v42 = String string="value"
// CHECK-NEXT: v43 = StrictEq v15, v42
// CHECK-NEXT: Branch v43 -> taken b17(), notTaken b34()
// CHECK-NEXT: b17():
// CHECK-NEXT: CheckEvaluation [ofFunction]
// CHECK-NEXT: v45 = NewClosure function=[[f_9]]
// CHECK-NEXT: Jump -> next b35(v45)
// CHECK-NEXT: b18():
// CHECK-NEXT: v46 = String string="value"
// CHECK-NEXT: v47 = StrictEq v15, v46
// CHECK-NEXT: Branch v47 -> taken b19(), notTaken b34()
// CHECK-NEXT: b19():
// CHECK-NEXT: CheckEvaluation [ofFunction]
// CHECK-NEXT: v49 = NewClosure function=[[f_10]]
// CHECK-NEXT: Jump -> next b35(v49)
// CHECK-NEXT: b20():
// CHECK-NEXT: v50 = String string="value"
// CHECK-NEXT: v51 = StrictEq v15, v50
// CHECK-NEXT: Branch v51 -> taken b21(), notTaken b34()
// CHECK-NEXT: b21():
// CHECK-NEXT: CheckEvaluation [ofFunction]
// CHECK-NEXT: v53 = NewClosure function=[[f_11]]
// CHECK-NEXT: Jump -> next b35(v53)
// CHECK-NEXT: b22():
// CHECK-NEXT: v54 = String string="value"
// CHECK-NEXT: v55 = StrictEq v15, v54
// CHECK-NEXT: Branch v55 -> taken b23(), notTaken b34()
// CHECK-NEXT: b23():
// CHECK-NEXT: CheckEvaluation [ofFunction]
// CHECK-NEXT: v57 = NewClosure function=[[f_12]]
// CHECK-NEXT: Jump -> next b35(v57)
// CHECK-NEXT: b24():
// CHECK-NEXT: v58 = String string="value"
// CHECK-NEXT: v59 = StrictEq v15, v58
// CHECK-NEXT: Branch v59 -> taken b25(), notTaken b34()
// CHECK-NEXT: b25():
// CHECK-NEXT: CheckEvaluation [ofFunction]
// CHECK-NEXT: v61 = NewClosure function=[[f_13]]
// CHECK-NEXT: Jump -> next b35(v61)
// CHECK-NEXT: b26():
// CHECK-NEXT: v62 = String string="value"
// CHECK-NEXT: v63 = StrictEq v15, v62
// CHECK-NEXT: Branch v63 -> taken b27(), notTaken b34()
// CHECK-NEXT: b27():
// CHECK-NEXT: CheckEvaluation [ofFunction]
// CHECK-NEXT: v65 = NewClosure function=[[f_14]]
// CHECK-NEXT: Jump -> next b35(v65)
// CHECK-NEXT: b28():
// CHECK-NEXT: v66 = String string="value"
// CHECK-NEXT: v67 = StrictEq v15, v66
// CHECK-NEXT: Branch v67 -> taken b29(), notTaken b34()
// CHECK-NEXT: b29():
// CHECK-NEXT: CheckEvaluation [ofFunction]
// CHECK-NEXT: v69 = NewClosure function=[[f_15]]
// CHECK-NEXT: Jump -> next b35(v69)
// CHECK-NEXT: b30():
// CHECK-NEXT: v70 = String string="value"
// CHECK-NEXT: v71 = StrictEq v15, v70
// CHECK-NEXT: Branch v71 -> taken b31(), notTaken b34()
// CHECK-NEXT: b31():
// CHECK-NEXT: CheckEvaluation [ofFunction]
// CHECK-NEXT: v73 = NewClosure function=[[f_16]]
// CHECK-NEXT: Jump -> next b35(v73)
// CHECK-NEXT: b32():
// CHECK-NEXT: v74 = String string="value"
// CHECK-NEXT: v75 = StrictEq v15, v74
// CHECK-NEXT: Branch v75 -> taken b33(), notTaken b34()
// CHECK-NEXT: b33():
// CHECK-NEXT: CheckEvaluation [ofFunction]
// CHECK-NEXT: v77 = NewClosure function=[[f_17]]
// CHECK-NEXT: Jump -> next b35(v77)
// CHECK-NEXT: b34():
// CHECK-NEXT: v78 = Construct v14, -, v15, v19 calleeName="Function"
// CHECK-NEXT: Jump -> next b35(v78)
// CHECK-NEXT: b35(v79):
// CHECK-NEXT: ElemSet v2, v8, v79
// CHECK-NEXT: Jump -> next b37(v79)
// CHECK-NEXT: b36(v81):
// CHECK-NEXT: Jump -> next b37(v81)
// CHECK-NEXT: b37(v82):
// CHECK-NEXT: Return v82
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=Object
// CHECK-NEXT: v1 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="root"
// CHECK-NEXT: v4 = Call v1, v0, v3 calleeName="Object.create"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_19]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_20]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_20]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Boolean boolean=true
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
