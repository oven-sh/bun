// RUN: lower
// OPTIONS: builtin-modules

// A generator gets its prototype from the property `prototype` of its function as that is once the parameters are evaluated. A head with branches and no call leaves the property alone;
// a call, a getter or a store in any of its arms may change it.
const generatorPrototype = Object.getPrototypeOf(function* () {}).prototype;
const asyncGeneratorPrototype = Object.getPrototypeOf(async function* () {}).prototype;
const names = new Map([[generatorPrototype, "%GeneratorPrototype%"], [asyncGeneratorPrototype, "%AsyncGeneratorPrototype%"]]);
const named = (name, object = Object.create(generatorPrototype)) => { names.set(object, name); return object; };
const protoOf = generator => names.get(Object.getPrototypeOf(generator)) ?? "its own";
const line = (...parts) => console.log(parts.join(" "));

// Branches and constants alone.
function* constant(a = 1) { yield a; }
function* constants(a = 1, b = "two", c = a > 1 ? 3 : 4) { yield [a, b, c].join(); }
function* literal(options = { deep: false }, list = []) { yield options.deep + "," + list.length; }
named("constant.first", constant.prototype);
line(protoOf(constant()), protoOf(constant(5)), constant().next().value, constant(5).next().value);
constant.prototype = named("constant.second");
line(protoOf(constant()), protoOf(constant(5)), constant(undefined).next().value);
constant.prototype = 7;
line(protoOf(constant()), protoOf(constant(5)));
constant.prototype = null;
line(protoOf(constant()), protoOf(constant(5)));
constant.prototype = named("constant.third");
line(protoOf(constant()), protoOf(constant(5)));
named("constants", constants.prototype); named("literal", literal.prototype);
line(protoOf(constants()), constants().next().value, constants(2).next().value, constants(0, "b", 9).next().value, protoOf(literal()), literal().next().value, literal({ deep: true }, [1]).next().value);

// The default value changes the property.
function* stores(a = (stores.prototype = named("stores.by default"), 1)) { yield a; }
named("stores.first", stores.prototype);
line(protoOf(stores(0)), protoOf(stores()), protoOf(stores(0)));
function change(of, name, above = generatorPrototype) { of.prototype = named(name, Object.create(above)); return 1; }
function* calls(a = change(calls, "calls.by default")) { yield a; }
named("calls.first", calls.prototype);
line(protoOf(calls(0)), protoOf(calls()), protoOf(calls(0)));

// Only one arm of the head calls.
function* oneArm(a = 1, b = a > 1 ? change(oneArm, "oneArm.changed " + a) : 0) { yield a + b; }
named("oneArm.first", oneArm.prototype);
line(protoOf(oneArm()), protoOf(oneArm(1)), protoOf(oneArm(2)), protoOf(oneArm(1)), protoOf(oneArm(3, 0)), protoOf(oneArm(4)));

// The call stands in front of the branch, and behind it.
function* callFirst(a = change(callFirst, "callFirst.changed"), b = 2) { yield a + b; }
function* callLast(a = 1, b = change(callLast, "callLast.changed")) { yield a + b; }
named("callFirst.first", callFirst.prototype); named("callLast.first", callLast.prototype);
line(protoOf(callFirst(1, 1)), protoOf(callFirst(1)), protoOf(callFirst()), protoOf(callLast(1, 1)), protoOf(callLast()), protoOf(callLast(1, 1)));

// Getters, iterators and conversions in patterns.
function* pattern({ x = 1, y } = {}) { yield x + "," + y; }
named("pattern.first", pattern.prototype);
const sly = { get y() { pattern.prototype = named("pattern.by getter"); return 2; } };
line(protoOf(pattern()), protoOf(pattern({ x: 3 })), protoOf(pattern(sly)), protoOf(pattern()));
function* listPattern([first = 1, second] = []) { yield first + "," + second; }
named("listPattern.first", listPattern.prototype);
const slyList = { [Symbol.iterator]() { listPattern.prototype = named("listPattern.by iterator"); return [5, 6][Symbol.iterator](); } };
line(protoOf(listPattern()), protoOf(listPattern([1])), protoOf(listPattern(slyList)), listPattern(slyList).next().value);
function* computed({ [key()]: value = 0 } = {}) { yield value; }
function key() { computed.prototype = named("computed.by key"); return "k"; }
named("computed.first", computed.prototype);
line(protoOf(computed({ k: 1 })), computed({ k: 8 }).next().value);

// A head that throws gives no generator, and the change stays.
function* throwing(a = 1, b = a > 1 ? fail() : 0) { yield a + b; }
function fail() { throwing.prototype = named("throwing.changed"); throw new RangeError("head"); }
named("throwing.first", throwing.prototype);
try { throwing(2); } catch (error) { line(error.message); }
line(protoOf(throwing()));

// Methods, and functions that are handed around.
class Tree {
  *walk(depth = 0, step = depth ? 2 : 1) { yield depth + step; }
  static *make(count = 1) { yield count; }
}
named("walk", Tree.prototype.walk.prototype); named("make", Tree.make.prototype);
const tree = new Tree();
line(protoOf(tree.walk()), protoOf(tree.walk(1)), tree.walk(1).next().value, protoOf(Tree.make()), protoOf(Tree.make(2)));
Tree.prototype.walk.prototype = named("walk.second");
line(protoOf(tree.walk()), protoOf(tree.walk(1, 1)));
const handed = [constant, constants, oneArm, pattern];
line(handed.map(each => protoOf(each())).join(" | "), "|", handed.map(each => protoOf(Reflect.apply(each, undefined, [1]))).join(" | "));

// Each closure of a function has a property of its own.
const closures = [0, 1, 2].map(number => { function* inner(a = number) { yield a; } named("inner." + number, inner.prototype); return inner; });
line(closures.map(each => protoOf(each()) + ":" + each().next().value + ":" + each(9).next().value).join(" "));
closures[1].prototype = named("inner.1 again");
line(closures.map(each => protoOf(each(4))).join(" "));

// Often, with a change in the middle.
function* often(a = 1) { yield a; }
named("often.first", often.prototype);
const seen = new Map();
for (let round = 0; round < 20000; round++) {
  if (round === 12345) often.prototype = named("often.second");
  const name = protoOf(round & 1 ? often() : often(round));
  seen.set(name, (seen.get(name) ?? 0) + 1);
}
line([...seen].join(" "));

// Async generators.
async function* asyncConstant(a = 1) { yield a; }
async function* asyncCalls(a = change(asyncCalls, "asyncCalls.by default", asyncGeneratorPrototype), b = 2) { yield a + b; }
named("asyncConstant.first", asyncConstant.prototype); named("asyncCalls.first", asyncCalls.prototype);
line(protoOf(asyncConstant()), protoOf(asyncConstant(2)), protoOf(asyncCalls(1)), protoOf(asyncCalls()), protoOf(asyncCalls(1, 1)));
asyncConstant.prototype = named("asyncConstant.second", Object.create(asyncGeneratorPrototype));
line(protoOf(asyncConstant()), protoOf(asyncConstant(2)));
asyncConstant.prototype = undefined;
line(protoOf(asyncConstant()), protoOf(asyncConstant(2)));
line((await asyncConstant().next()).value, (await asyncConstant(3).next()).value, (await asyncCalls().next()).value);

// GENERATED: fail asyncConstant Tree line [Symbol.iterator]
// CHECK-LABEL: function {{*}}name="fail"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="named"
// CHECK-NEXT: v3 = String string="throwing.changed"
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="named"
// CHECK-NEXT: PropSet v0, v4 key="prototype"
// CHECK-NEXT: v6 = Builtin builtin=GlobalThis
// CHECK-NEXT: v7 = PropGet v6 key="RangeError" [isFreeName]
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(RangeError) flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="head"
// CHECK-NEXT: v10 = Construct v8, -, v9 calleeName="RangeError"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|RangeError flags=[IsExpected]}
// CHECK-NEXT: Throw v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asyncConstant"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=undefined|number flags=[IsExpected]}] results=[{type=undefined|null|AsyncGenerator<number> flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything, v1: function, v2: undefined|number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = TypeTest v2 testedType=undefined
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b5(v6)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5(v7)
// CHECK-NEXT: b5(v8):
// CHECK-NEXT: InitialYield v8
// CHECK-NEXT: v10 = Await v8, v8
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v12 = Yield v11, v8
// CHECK-NEXT: v13 = ResultAt v12
// CHECK-NEXT: v14 = ResultAt v12 index=1
// CHECK-NEXT: Switch v14 cases=[1, 2] -> case b6(), case b7(), otherwise b8()
// CHECK-NEXT: b6():
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b7():
// CHECK-NEXT: Return v13
// CHECK-NEXT: b8():
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Tree"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="line"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[HasRestParameter] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v0 key="join"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v8 = String string=" "
// CHECK-NEXT: v9 = Call v7, v0, v8 calleeKey="join" calleeName="parts.join"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v5, v3, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|[[L_7]]|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="named"
// CHECK-NEXT: v3 = String string="listPattern.by iterator"
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="named"
// CHECK-NEXT: PropSet v0, v4 key="prototype"
// CHECK-NEXT: v6 = Data data=[[d_9]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key=@@iterator
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: v10 = Call v9, v7 calleeKey=@@iterator
// CHECK-NEXT: ReturnCall v10 casts=[{declared={type=undefined|null|[[L_7]]|Generator flags=[IsExpected]}}]
// CHECK-NEXT: }
