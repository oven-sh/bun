// RUN: lower
// OPTIONS: builtin-modules

// `f.length` and `f.name` answer with what the function was written with until the program defines them anew, deletes them or hands the function to code that does.
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));
function three(a, b, c) {}
function withDefault(a, b = 1, c) {}
function withRest(a, ...rest) {}
const arrow = (a, b) => a;
const named = function inner(a) {};
const holder = { method(a, b, c, d) {}, get got() { return 1; }, ["comp" + "uted"](a) {}, plain: function () {}, [Symbol.iterator]() {} };
async function later(a) {}
function* steps(a, b) {}
class Shape { constructor(a, b) {} static make(a) {} area(a, b, c) {} }
class Odd { static length = 9; static name = "odd"; }
class OddMethods { static name() { return "called"; } }
for (let round = 0; round < 2; round++) {
  say(three.length, three.name, withDefault.length, withRest.length, arrow.length, arrow.name, named.name, named.length);
  say(holder.method.length, holder.method.name, Object.getOwnPropertyDescriptor(holder, "got").get.name, holder.computed.name, holder.plain.name, holder[Symbol.iterator].name);
  say(later.length, later.name, steps.length, steps.name, Shape.length, Shape.name, Shape.make.length, Shape.make.name, Shape.prototype.area.length, Odd.length, Odd.name, typeof OddMethods.name);
  say(three.bind(null, 1).length, three.bind(null).name, arrow.bind(null, 1, 2, 3).length);
}
function redefined(a, b) {}
say(redefined.length, redefined.name);
Object.defineProperty(redefined, "length", { value: 40 });
Object.defineProperty(redefined, "name", { value: "other" });
say(redefined.length, redefined.name);
function deleted(a, b) {}
say(delete deleted.length, delete deleted.name, deleted.length, JSON.stringify(deleted.name), Object.hasOwn(deleted, "length"));
function stored(a) {}
try {
  stored.length = 5;
} catch (error) {
  say(error.name);
}
try {
  stored.name = "no";
} catch (error) {
  say(error.name);
}
say(stored.length, stored.name);
function below(a, b, c) {}
delete below.length;
Object.setPrototypeOf(below, { length: "inherited", name: "up" });
say(below.length, below.name);
function changedByKey(a) {}
const key = ["len", "gth"].join("");
Object.defineProperty(changedByKey, key, { value: 77 });
say(changedByKey.length);
function changedElsewhere(a) {}
const change = target => Object.defineProperty(target, "name", { get() { return "got"; } });
say(changedElsewhere.name);
change(changedElsewhere);
say(changedElsewhere.name);
function handedOut(a, b) {}
globalThis.taken = handedOut;
new Function("Object.defineProperty(taken, 'length', { value: 12 })")();
say(handedOut.length);
function made() { return function inner(a, b) {}; }
const first = made(), second = made();
Object.defineProperty(first, "length", { value: 1 });
say(first.length, second.length, first.name, second.name);
for (const called of [three, withDefault, withRest, arrow, named, holder.method, holder.computed, holder.plain, later, steps, redefined, deleted, stored, below, changedByKey, changedElsewhere, handedOut, first, second]) called(1, 2);
say(three.length, three.name, redefined.length, redefined.name, deleted.length, below.length, changedByKey.length, changedElsewhere.name, handedOut.length, first.length, second.length);
console.log(lines.join("\n"));

// GENERATED: later steps Shape say got computed change
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Promise flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="steps"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|Generator<never> flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: anything, v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield v2, v3
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Shape"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b4(v8)
// CHECK-NEXT: b3(v9):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="say"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="lines"
// CHECK-NEXT: v3 = PropGet v2 key="push"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v0 key="join"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" "
// CHECK-NEXT: v8 = Call v6, v0, v7 calleeKey="join" calleeName="parts.join"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v10 = Call v4, v2, v9 calleeKey="push" calleeName="lines.push"
// CHECK-NEXT: ReturnCall v10 casts=[{declared={type=number flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="got"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="computed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="change"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_8]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v3 = String string="name"
// CHECK-NEXT: v4 = NewClosure function=[[f_10]]
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v6 = NewObject layout=[[L_12]]
// CHECK-NEXT: PropDefine v6, v5 key="get"
// CHECK-NEXT: v8 = FinishObject v6
// CHECK-NEXT: v9 = Call v2, v1, v0, v3, v8 calleeName="Object.defineProperty"
// CHECK-NEXT: ReturnCall v9
// CHECK-NEXT: }
