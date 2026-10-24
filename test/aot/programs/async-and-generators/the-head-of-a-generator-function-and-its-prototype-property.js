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
