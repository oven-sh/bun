// Text made at run time constructs functions of the program that do nothing, again and again at one place, while the program replaces prototypes, new.target and the functions themselves.
const nothing = String(Date.now()).slice(99);
const text = (parameters, body) => new Function(...parameters, body + nothing);
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return `${error.constructor.name}: ${error.message.split(" (In ")[0]}`;
  }
};
const prototypeNames = new Map([[null, "null"], [Object.prototype, "Object.prototype"]]);
const show = value => {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return String(value);
  const prototype = Object.getPrototypeOf(value);
  return `${prototypeNames.get(prototype) ?? "?"} ${JSON.stringify(value)} ${Object.getOwnPropertyNames(value).join()}`;
};

const construct = text(["F"], "return new F();");
const constructWithArguments = text(["F", "log"], "return new F(log.push('first'), log.push('second'));");
const constructAndStore = text(["F", "values"], "const o = new F(); o['a'] = values[0]; o.b = values[1]; return o;");
const constructSpread = text(["F", "list"], "return new F(...list);");
const constructFor = text(["F", "G"], "return Reflect.construct(F, [], G);");
const subclass = text(["F"], "return class extends F { constructor() { super(); this.below = new.target.name; } };");

const NullObject = function () {};
NullObject.prototype = Object.create(null);
prototypeNames.set(NullObject.prototype, "first");

function repeat(times, run) {
  let last;
  for (let i = 0; i < times; i++) last = run(i);
  return last;
}

console.log("same place, many times:", show(repeat(50, () => construct(NullObject))));
console.log("stores:", show(repeat(50, i => constructAndStore(NullObject, ["west", i]))));
console.log("starts empty again:", show(construct(NullObject)));
const one = construct(NullObject);
const other = construct(NullObject);
one.mine = 1;
console.log("two objects:", one === other, show(one), show(other));

const log = [];
console.log("arguments are evaluated:", show(repeat(3, () => constructWithArguments(NullObject, log))), log.join());
console.log("spread:", show(constructSpread(NullObject, [1, 2, 3])));

const second = { inherited: "second" };
prototypeNames.set(second, "second");
NullObject.prototype = second;
console.log("prototype replaced:", show(construct(NullObject)), construct(NullObject).inherited);
console.log("again:", show(repeat(50, () => construct(NullObject))));
NullObject.prototype = 5;
console.log("prototype is a number:", show(repeat(50, () => construct(NullObject))));
NullObject.prototype = null;
console.log("prototype is null:", show(repeat(50, () => construct(NullObject))));
const third = Object.create(null);
prototypeNames.set(third, "third");
Object.defineProperty(NullObject, "prototype", { value: third, writable: false });
console.log("prototype defined:", show(repeat(50, () => construct(NullObject))));
console.log("prototype cannot be stored:", attempt(() => (NullObject.prototype = second) && "stored"), show(construct(NullObject)));
third.late = "seen";
console.log("property added to the prototype:", construct(NullObject).late);
Object.setPrototypeOf(third, { deeper: "deep" });
console.log("prototype of the prototype:", construct(NullObject).deeper);

function Target() {}
prototypeNames.set(Target.prototype, "Target.prototype");
function Empty() {}
prototypeNames.set(Empty.prototype, "Empty.prototype");
console.log("own new.target:", show(repeat(50, () => construct(Empty))), construct(Empty) instanceof Empty, construct(Empty).constructor === Empty);
console.log("other new.target:", show(repeat(50, () => constructFor(Empty, Target))), constructFor(Empty, Target) instanceof Target);
console.log("own again:", show(construct(Empty)));
const Below = subclass(Empty);
prototypeNames.set(Below.prototype, "Below.prototype");
console.log("class of the text below it:", show(repeat(50, () => new Below())), new Below() instanceof Empty);
console.log("own once more:", show(construct(Empty)));

let effects = 0;
function Counts() {
  effects++;
}
function DefaultCounts(a = effects++) {}
function ReturnsObject() {
  return second;
}
function ReturnsFunction() {
  return Empty;
}
function ReturnsNumber() {
  return 5;
}
function ReturnsUndefined() {
  return undefined;
}
function ReturnsNothing() {
  return;
}
function Throws() {
  throw new RangeError("from the constructor");
}
function Stores() {
  this.own = 1;
}
function ReadsTarget() {
  if (new.target !== ReadsTarget) effects += 100;
}
function ReturnsArgument(a) {
  return a;
}
function ReturnsSecondArgument(a, b) {
  return b;
}
function ReturnsThis() {
  return this;
}
function Destructures({ a }) {}
function Rest(...rest) {}
function Unused(a, b, c) {}
function DeadCode() {
  if (false) effects++;
}
for (const F of [Counts, DefaultCounts, ReturnsNumber, ReturnsUndefined, ReturnsNothing, Throws, Stores, ReadsTarget, Destructures, Rest, Unused, DeadCode]) prototypeNames.set(F.prototype, `${F.name}.prototype`);
for (const F of [Counts, DefaultCounts, ReturnsObject, ReturnsFunction, ReturnsNumber, ReturnsUndefined, ReturnsNothing, Throws, Stores, ReadsTarget, Destructures, Rest, Unused, DeadCode]) {
  const before = effects;
  console.log(`${F.name}:`, repeat(20, () => attempt(() => show(construct(F)))), effects - before);
}

const constructWith = text(["F", "a", "b"], "return new F(a, b);");
for (const F of [ReturnsArgument, ReturnsSecondArgument, ReturnsThis, Unused]) {
  prototypeNames.set(F.prototype, `${F.name}.prototype`);
  console.log(`${F.name} of two objects:`, repeat(20, () => show(constructWith(F, second, third))), "of two numbers:", repeat(20, () => show(constructWith(F, 1, 2))), "of nothing:", show(construct(F)));
}

const arrow = () => {};
const method = { method() {} }.method;
async function asynchronous() {}
function* generator() {}
class EmptyClass {}
prototypeNames.set(EmptyClass.prototype, "EmptyClass.prototype");
const bound = Empty.bind(null);
const proxied = new Proxy(Empty, {});
const trapped = new Proxy(Empty, {
  construct() {
    return { trapped: true };
  },
});
for (const [name, F] of Object.entries({ arrow, method, asynchronous, generator, EmptyClass, bound, proxied, trapped, number: 5, nothing: undefined, object: {} }))
  console.log(`${name}:`, repeat(20, () => attempt(() => show(construct(F)))));

console.log("one place, one function after another:", [Empty, NullObject, Stores, Empty, EmptyClass, Target, NullObject, Empty].map(F => show(construct(F))).join(" | "));

const makeEmpty = () => function () {};
const first = makeEmpty();
const twin = makeEmpty();
prototypeNames.set(first.prototype, "first of two");
prototypeNames.set(twin.prototype, "second of two");
console.log("two function objects of one function:", show(repeat(20, () => construct(first))), show(repeat(20, () => construct(twin))), show(construct(first)));

Empty.extra = "a property of the function";
console.log("function with a property:", show(repeat(20, () => construct(Empty))));
Object.freeze(Empty);
console.log("frozen function:", show(repeat(20, () => construct(Empty))));

const kept = [];
let sum = 0;
for (let i = 0; i < 300000; i++) {
  const o = constructAndStore(Target, [i, "x" + (i & 7)]);
  if ((i & 4095) === 0) kept.push(o);
  sum = (sum + o.a + o.b.length) | 0;
}
Bun.gc(true);
console.log("many:", sum, kept.length, kept.every((o, i) => o.a === i * 4096 && o.b === "x0" && Object.getPrototypeOf(o) === Target.prototype && Object.keys(o).join() === "a,b"));

const wide = construct(Target);
for (let i = 0; i < 12; i++) wide["p" + i] = i;
console.log("more properties than fit the cell:", JSON.stringify(wide), JSON.stringify(construct(Target)));
