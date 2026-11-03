// RUN: lower
// OPTIONS: builtin-modules

// The places that read names of objects are handed numbers, strings, booleans, symbols and bigints, and nothing at all, between the objects.
const out = [];
const suffix = process.argv[2] ?? "";
// What the compiler cannot read: it only knows that the objects go there and come back.
const hide = new Function("value", "return value" + suffix);
function describe(value) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "symbol") return String(value);
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}
function attempt(action) {
  try {
    return describe(action());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}
// One place in the program reads each name, whatever object comes.
function readValue(object) {
  return object.value;
}
function readOther(object) {
  return object.other;
}
function readMissing(object) {
  return object.missing;
}
function callMethod(object) {
  return object.method();
}
function readAll(object) {
  return [attempt(() => readValue(object)), attempt(() => readOther(object)), attempt(() => readMissing(object)), attempt(() => callMethod(object))].join(" ");
}
function warm(object) {
  let last = "";
  for (let turn = 0; turn < 200; turn++) last = readAll(object);
  return last;
}
// Three objects in a row, made in four ways. `value` lies on the receiver, `other` in the middle, `method` at the top, `missing` nowhere.
function chainOfLiterals() {
  const top = { method() { return "method of the top"; } };
  const middle = Object.setPrototypeOf({ other: "other of the middle" }, top);
  const receiver = Object.setPrototypeOf({ value: "value of the receiver" }, middle);
  return { receiver, middle, top };
}
function chainOfCreatedObjects() {
  const top = Object.create(null);
  top.method = function method() { return "method of the top"; };
  const middle = Object.create(top);
  middle.other = "other of the middle";
  const receiver = Object.create(middle);
  receiver.value = "value of the receiver";
  return { receiver, middle, top };
}
function chainOfClasses() {
  class Top {
    method() { return "method of the top"; }
  }
  class Middle extends Top {}
  Middle.prototype.other = "other of the middle";
  class Receiver extends Middle {
    constructor() {
      super();
      this.value = "value of the receiver";
    }
  }
  return { receiver: new Receiver(), middle: Middle.prototype, top: Top.prototype };
}
function chainOfConstructorFunctions() {
  function Top() {}
  Top.prototype.method = function method() { return "method of the top"; };
  function Middle() {}
  Middle.prototype = Object.create(Top.prototype);
  Middle.prototype.other = "other of the middle";
  function Receiver() {
    this.value = "value of the receiver";
  }
  Receiver.prototype = Object.create(Middle.prototype);
  return { receiver: new Receiver(), middle: Middle.prototype, top: Top.prototype };
}
const makers = { literals: chainOfLiterals, "created objects": chainOfCreatedObjects, classes: chainOfClasses, "constructor functions": chainOfConstructorFunctions };
// Each change meets a chain of its own, warm, and a second receiver of the same making that was warm before the change too.
function tryChange(name, change) {
  for (const [kind, make] of Object.entries(makers)) {
    const chain = hide(make());
    const before = warm(chain.receiver);
    const said = attempt(() => change(chain));
    out.push(`${name} | ${kind} | ${before} | ${said} | ${readAll(chain.receiver)} | ${warm(chain.receiver)}`);
  }
}
const chain = hide(chainOfClasses());
warm(chain.receiver);
const primitives = [["a number", 5], ["a fraction", 0.5], ["NaN", NaN], ["a string", "text"], ["an empty string", ""], ["true", true], ["false", false], ["a symbol", Symbol("s")], ["a bigint", 10n], ["null", null], ["undefined", undefined]];
for (const [word, value] of primitives) {
  const hidden = hide(value);
  out.push(`${word} | ${warm(hidden)} | ${readAll(chain.receiver)}`);
}
function readToString(value) {
  return value.toString;
}
function readConstructor(value) {
  return value.constructor;
}
function callValueOf(value) {
  return value.valueOf();
}
function callToString(value) {
  return value.toString();
}
for (const [word, value] of [...primitives, ["an object", {}], ["an object without a prototype", Object.create(null)], ["an array", [1, 2]], ["a function", function named() {}], ["an instance", chain.receiver]]) {
  const hidden = hide(value);
  let last = "";
  for (let turn = 0; turn < 200; turn++)
    last = [attempt(() => readToString(hidden)), attempt(() => readConstructor(hidden)), attempt(() => typeof callValueOf(hidden)), attempt(() => callToString(hidden))].join(" ");
  out.push(`names of the prototypes of the language | ${word} | ${last}`);
}
const own = hide({ toString() { return "own toString"; }, valueOf: () => 42, constructor: "own constructor" });
out.push(`an object with names of its own | ${attempt(() => readToString(own))} ${attempt(() => readConstructor(own))} ${attempt(() => callValueOf(own))} ${attempt(() => callToString(own))}`);
delete own.toString;
delete own.constructor;
out.push(`which it loses | ${attempt(() => readToString(own))} ${attempt(() => readConstructor(own))} ${attempt(() => callValueOf(own))} ${attempt(() => callToString(own))}`);
console.log(out.join("\n"));

// GENERATED: attempt tryChange Top Middle Receiver
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = Call v0 calleeName="action"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v4 = Call v1, -, v3 calleeName="describe"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v6 = CatchValue
// CHECK-NEXT: v7 = String string="threw "
// CHECK-NEXT: v8 = PropGet v6 key="constructor"
// CHECK-NEXT: v9 = PropGet v8 key="name"
// CHECK-NEXT: v10 = Add v7, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tryChange"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewRuntimeError runtimeError=LeftOutOfExecutable name="tryChange"
// CHECK-NEXT: Throw v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Top"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Middle"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_6]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Receiver"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstruct v3, v1 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = TypeTest v2 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v9) frequency=Unlikely:
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v13 = String string="value of the receiver"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: PropSet v12, v14 key="value"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: v17 = TypeTest v16 testedType=object
// CHECK-NEXT: Branch v17 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v18):
// CHECK-NEXT: Jump -> next b10(v18)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: v20 = TypeTest v19 testedType=undefined
// CHECK-NEXT: Branch v20 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v21):
// CHECK-NEXT: v22 = TypeTest v11 testedType=absent
// CHECK-NEXT: Branch v22 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v23) frequency=Unlikely:
// CHECK-NEXT: v24 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v24
// CHECK-NEXT: b9(v25):
// CHECK-NEXT: Jump -> next b10(v25)
// CHECK-NEXT: b10(v26):
// CHECK-NEXT: Return v26
// CHECK-NEXT: b11(v27) frequency=Unlikely:
// CHECK-NEXT: v28 = NewRuntimeError runtimeError=DerivedConstructorResult name="Receiver"
// CHECK-NEXT: Throw v28
// CHECK-NEXT: b12(v29) frequency=Unlikely:
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v30
// CHECK-NEXT: }
