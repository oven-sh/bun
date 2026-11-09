// An access whose key can only be one symbol that is made once is built by the name of that symbol. Each line is a way to take two properties for one, or one for two: two symbols of one description, a symbol made in a function that is called twice or in a loop, Symbol.for, a variable that holds one of two symbols or sometimes a text, well-known symbols, and whoever lists, copies, defines, freezes or wraps the object.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
const first = Symbol("same");
const second = Symbol("same");
const plain = Symbol();
const registered = Symbol.for("registered");
const text = "text";
class Holder { constructor(a, b) { this[first] = a; this[second] = b; this[plain] = a + b; this.name = "holder"; } get [registered]() { return "getter of " + this.name; } }
function readFirst(o) { return o[first]; }
function readSecond(o) { return o[second]; }
function readPlain(o) { return o[plain]; }
function readRegistered(o) { return o[registered]; }
function storeFirst(o, v) { o[first] = v; return o[first]; }
function hasFirst(o) { return first in o; }
function dropFirst(o) { return delete o[first]; }
const holder = new Holder(1, 2);
report(readFirst(holder));
report(readSecond(holder));
report(readPlain(holder));
report(readRegistered(holder));
report(storeFirst(holder, 10));
report(readSecond(holder));
report(hasFirst(holder));
report(hasFirst({}));
report(first === second);
report(first.description === second.description);
report(String(first));
report(Object.getOwnPropertySymbols(holder).length);
report(Object.getOwnPropertySymbols(holder)[0] === first);
report(Object.getOwnPropertySymbols(holder)[1] === second);
report(holder[Object.getOwnPropertySymbols(holder)[0]]);
report(Reflect.ownKeys(holder).length);
report(JSON.stringify(holder));
report(Object.keys(holder).length);
const spread = { ...holder };
report(readFirst(spread));
report(readSecond(spread));
report(Object.getOwnPropertySymbols(spread).length);
const assigned = Object.assign({}, holder);
report(readFirst(assigned));
report(readPlain(assigned));
const assignedInto = Object.assign(new Holder(5, 6), { [first]: 50 });
report(readFirst(assignedInto));
report(readSecond(assignedInto));
report(dropFirst(holder));
report(readFirst(holder));
report(hasFirst(holder));
report(Object.getOwnPropertySymbols(holder).length);
function make() { return Symbol("made"); }
const madeOnce = make();
const madeTwice = make();
report(madeOnce === madeTwice);
const byMade = { [madeOnce]: "once", [madeTwice]: "twice" };
report(byMade[madeOnce]);
report(byMade[madeTwice]);
report(Object.getOwnPropertySymbols(byMade).length);
const inLoop = [];
for (let turn = 0; turn < 3; turn++) inLoop[turn] = Symbol("turn");
const byLoop = {};
for (let turn = 0; turn < 3; turn++) byLoop[inLoop[turn]] = turn;
report(byLoop[inLoop[0]]);
report(byLoop[inLoop[1]]);
report(byLoop[inLoop[2]]);
report(Object.getOwnPropertySymbols(byLoop).length);
function factory() { const tag = Symbol("tag"); return class Tagged { [tag] = 1; static tag = tag; read() { return this[tag]; } }; }
const One = factory();
const Two = factory();
report(new One().read());
report(new Two().read());
report(new One()[Two.tag]);
report(One.tag === Two.tag);
function pick(flag) { return flag ? first : second; }
function readPicked(o, flag) { const key = pick(flag); return o[key]; }
const picked = new Holder(7, 8);
report(readPicked(picked, true));
report(readPicked(picked, false));
let either = first;
function readEither(o) { return o[either]; }
report(readEither(picked));
either = second;
report(readEither(picked));
function readUnder(o, key) { return o[key]; }
report(readUnder(picked, first));
report(readUnder(picked, "name"));
report(readUnder(picked, second));
report(readUnder([4, 5, 6], 1));
let sometimes = first;
function readSometimes(o) { return o[sometimes]; }
report(readSometimes(picked));
sometimes = "name";
report(readSometimes(picked));
report(registered === Symbol.for("registered"));
report(Symbol.keyFor(registered));
report(Symbol.keyFor(first));
const underRegistered = { [Symbol.for("registered")]: "by for" };
report(underRegistered[registered]);
report(readRegistered(underRegistered));
const iterator = Symbol.iterator;
const iterable = { [iterator]() { let n = 0; return { next: () => ({ done: n >= 2, value: n++ }) }; } };
report(typeof iterable[iterator]);
report(typeof [][iterator]);
const toPrimitive = Symbol.toPrimitive;
const converts = { [toPrimitive](hint) { return hint === "number" ? 42 : "text of " + hint; } };
report(+converts);
report(`${converts}`);
const toStringTag = Symbol.toStringTag;
const K = "viaConstant";
const byText = { viaConstant: 1 };
report(byText[K]);
byText[K] = 2;
report(byText.viaConstant);
report(byText[text]);
const proto = { [first]: "from above" };
const below = Object.create(proto);
report(readFirst(below));
below[first] = "own";
report(readFirst(below));
report(readFirst(proto));
const withSetter = { set [first](v) { this.stored = v * 2; }, get [first]() { return this.stored; } };
report(storeFirst(withSetter, 21));
const frozen = Object.freeze(new Holder(1, 2));
try { "use strict"; storeFirst(frozen, 3); report("stored"); }
catch (error) { report(error instanceof TypeError); }
report(readFirst(frozen));
report(readFirst(1));
report(readFirst("text"));
try { readFirst(undefined); report("read"); }
catch (error) { report(error instanceof TypeError); }
try { readFirst(null); report("read"); }
catch (error) { report(error instanceof TypeError); }
const proxied = new Proxy({}, { get(target, key) { return typeof key === "symbol" ? "symbol " + String(key.description) : "text " + key; }, has(target, key) { return key === first; } });
report(readFirst(proxied));
report(hasFirst(proxied));
report(second in proxied);
Object.defineProperty(picked, first, { get() { return "defined"; }, configurable: true });
report(readFirst(picked));
report(Object.getOwnPropertyDescriptor(picked, second).value);
report(Object.getOwnPropertyDescriptor(picked, second).enumerable);
const map = new Map([[first, "in map"]]);
report(map.get(first));
report(map.get(second));
report(typeof first);
report(Object(first) == first);
report(new Holder(1, 2)[Object(first)]);
report("end");
