// Object.assign and object spread copy data properties by a plan per pair of structures. A target or source that the plan cannot serve takes the generic path and gives the same result.
"use strict";
const lines = [];
const events = [];
const parse = text => JSON.parse(text);

function describe(object) {
  return Reflect.ownKeys(object)
    .map(key => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      const flags = (descriptor.writable ? "w" : "-") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
      return String(key) + "=" + ("value" in descriptor ? String(descriptor.value) : "accessor") + ":" + flags;
    })
    .join(" ");
}
function show(name, run) {
  const results = [];
  for (let round = 0; round < 4; round++) {
    let result;
    try {
      result = describe(run());
    } catch (error) {
      result = error.constructor.name;
    }
    if (events.length) result += " [" + events.splice(0).join(", ") + "]";
    if (!results.includes(result)) results.push(result);
  }
  lines.push(name + ": " + results.join(" | "));
}

function assign(target, source) { return Object.assign(target, source); }
function assignTwo(target, first, second) { return Object.assign(target, first, second); }
function assignAndKeep(target, source) {
  try {
    Object.assign(target, source);
  } catch (error) {
    events.push(error.constructor.name);
  }
  return target;
}
function spread(source) { return { ...source }; }
function spreadAfter(source) { return { a: "own", z: "own", ...source }; }
function spreadBefore(source) { return { ...source, a: "own" }; }
function spreadTwo(first, second) { return { ...first, ...second }; }
function spreadUnder(prototype, source) { return { __proto__: prototype, ...source }; }

const small = '{"a":1,"b":2,"c":3}';
const wide = JSON.stringify(Object.fromEntries(Array.from({ length: 20 }, (_, i) => ["p" + i, i])));

show("assign to an empty literal", () => assign({}, parse(small)));
show("assign over own properties", () => assign({ c: "own", a: "own" }, parse(small)));
show("assign to a parsed target", () => assign(parse('{"c":0,"x":0}'), parse(small)));
show("assign that grows the storage", () => assign(parse('{"x":0}'), parse(wide)));
show("assign two sources", () => assignTwo({}, parse(small), parse('{"b":"second","d":4}')));
show("assign a literal", () => assign({}, { a: 1, b: "two", c: 3.5, d: null, e: undefined, f: true }));
show("assign a literal to a parsed target", () => assign(parse('{"b":0}'), { a: 1, b: "two" }));
show("assign an object to itself", () => { const object = parse(small); return assign(object, object); });
show("assign nothing", () => assignTwo(parse(small), null, undefined));
show("spread a parsed object", () => spread(parse(small)));
show("spread 20 properties", () => spread(parse(wide)));
show("spread after own properties", () => spreadAfter(parse(small)));
show("spread before an own property", () => spreadBefore(parse(small)));
show("spread two sources", () => spreadTwo(parse(small), parse('{"b":"second","d":4}')));
show("spread a literal", () => spread({ a: 1, b: "two", c: 3.5 }));
show("spread primitives", () => spreadTwo(spreadTwo(null, 7), spreadTwo(undefined, "ab")));

function Foo() {}
Foo.prototype.greet = function () { return "first"; };
class Bar { greet() { return "first"; } }
function greet(object) { return object.greet(); }
function greetOften(object) { let text = ""; for (let i = 0; i < 200; i++) text = greet(object); return text; }
const foo = new Foo(), bar = new Bar();
for (const name of ["second", "third", "fourth"]) {
  const before = greetOften(foo) + " " + greetOften(bar);
  const mixin = Object.fromEntries([["greet", function () { return name; }]]);
  assign(Foo.prototype, mixin);
  assign(Bar.prototype, mixin);
  lines.push("method replaced on a prototype: " + before + " -> " + greetOften(foo) + " " + greetOften(bar) + ", keys " + Object.keys(Foo.prototype).join() + "|" + Object.keys(Bar.prototype).join());
}
assign(Foo.prototype, { greet() { return "from a literal"; }, extra: 1 });
lines.push("method replaced by a literal: " + greetOften(foo) + " " + foo.extra);

function readA(object) { return object.a; }
function readOften(object) { let value; for (let i = 0; i < 200; i++) value = readA(object); return value; }
const shared = assign(parse('{"a":0}'), parse(small));
const child = Object.create(shared);
const inheritedBefore = readOften(child);
assign(shared, parse('{"a":"changed","b":2,"c":3}'));
lines.push("target became a prototype: " + inheritedBefore + " -> " + readOften(child));

show("frozen target", () => assignAndKeep(Object.freeze(parse('{"a":0}')), parse(small)));
show("frozen literal", () => assignAndKeep(Object.freeze({ a: 0 }), parse(small)));
show("frozen target, empty source", () => assign(Object.freeze(parse('{"a":0}')), parse("{}")));
show("sealed target", () => assignAndKeep(Object.seal(parse('{"a":0,"b":0}')), parse(small)));
show("sealed target with every name", () => assign(Object.seal(parse('{"c":0,"b":0,"a":0}')), parse(small)));
show("non-extensible target", () => assignAndKeep(Object.preventExtensions(parse('{"b":0}')), parse(small)));
show("read-only own property", () => assignAndKeep(Object.defineProperty(parse('{"a":0}'), "b", { value: "fixed", enumerable: true }), parse(small)));
show("own setter", () => assign(Object.defineProperty(parse('{"a":0}'), "b", { set(value) { events.push("set b " + value); }, configurable: true }), parse(small)));
show("hidden own property", () => assign(Object.defineProperty({}, "b", { value: 0, writable: true, configurable: true }), parse(small)));

function dictionary(count) {
  const object = {};
  for (let i = 0; i < count; i++) object["k" + i] = i;
  for (let i = 0; i < count; i += 2) delete object["k" + i];
  return object;
}
function summarize(object) {
  const keys = Object.keys(object);
  return keys.length + " keys, " + keys.slice(0, 2).join() + " .. " + keys.slice(-4).map(key => key + "=" + object[key]).join();
}
lines.push("dictionary target: " + summarize(assign(dictionary(300), parse('{"k1":"replaced","a":1,"k0":"again"}'))));
lines.push("dictionary source: " + summarize(assign(parse('{"k1":"own","a":1}'), dictionary(300))));
lines.push("dictionary spread: " + summarize(spreadAfter(dictionary(300))));

const withSetter = { set a(value) { events.push("inherited set a " + value); } };
const withReadOnly = Object.defineProperty({}, "b", { value: "inherited", writable: false });
show("setter on the prototype", () => assign(Object.create(withSetter), parse(small)));
show("read-only property on the prototype", () => assignAndKeep(Object.create(withReadOnly), parse(small)));
show("spread ignores a setter on the prototype", () => spreadUnder(withSetter, parse(small)));
show("spread ignores a read-only property on the prototype", () => spreadUnder(withReadOnly, parse(small)));
show("proxy as the prototype", () => assign(Object.create(new Proxy({}, { set(target, key, value, receiver) { events.push("trap " + String(key)); return Reflect.set(target, key, value, receiver); } })), parse(small)));

const base = {};
const middle = Object.create(base);
show("plain prototypes", () => assign(Object.create(middle), parse(small)));
Object.defineProperty(base, "b", { set(value) { events.push("late set b " + value); }, configurable: true });
show("setter added to a prototype later", () => assign(Object.create(middle), parse(small)));
delete base.b;
show("setter removed again", () => assign(Object.create(middle), parse(small)));
Object.defineProperty(middle, "c", { value: "fixed", writable: false, configurable: true });
show("read-only property added to a prototype later", () => assignAndKeep(Object.create(middle), parse(small)));

const symbol = Symbol("visible"), hiddenSymbol = Symbol("hidden");
function withGetters() {
  return {
    get a() { events.push("get a"); return 1; },
    b: 2,
    get c() { events.push("get c"); return 3; },
  };
}
function withChangingGetter() {
  return {
    get a() { events.push("get a"); delete this.b; this.d = "late"; return 1; },
    b: 2,
    c: 3,
  };
}
function withSymbols() {
  const object = { [symbol]: "s", a: 1 };
  Object.defineProperty(object, hiddenSymbol, { value: "h", enumerable: false });
  Object.defineProperty(object, "hidden", { value: "h", enumerable: false });
  object.b = 2;
  return object;
}
for (const [name, copy] of [["assign", source => assign({}, source)], ["assign over", source => assign(parse('{"b":0,"1":0}'), source)], ["spread", spread], ["spread after", spreadAfter]]) {
  show(name + ": getters", () => copy(withGetters()));
  show(name + ": getter that changes the source", () => copy(withChangingGetter()));
  show(name + ": throwing getter", () => copy({ a: 1, get b() { throw new RangeError("b"); } }));
  show(name + ": index keys", () => copy({ 2: "two", b: 1, 0: "zero", a: 2, 1: "one" }));
  show(name + ": parsed index keys", () => copy(parse('{"2":"two","b":1,"0":"zero"}')));
  show(name + ": array", () => copy(["x", , "z"]));
  show(name + ": symbols and hidden properties", () => copy(withSymbols()));
  show(name + ": own __proto__", () => { const result = copy(parse('{"a":1,"__proto__":{"inherited":true}}')); events.push("inherited " + result.inherited); return result; });
  show(name + ": class instance", () => copy(new (class { #secret = 1; a = 1; b = 2; get c() { return this.#secret; } })()));
  show(name + ": proxy", () => copy(new Proxy(parse(small), { ownKeys(target) { events.push("ownKeys"); return Reflect.ownKeys(target).reverse(); } })));
}

const sources = [];
for (let i = 0; i < 5000; i++) {
  if (i & 1) {
    const source = {};
    source["p" + i] = i;
    source.shared = i + 1;
    sources.push(source);
  } else {
    sources.push(parse('{"p' + i + '":' + i + ',"shared":' + (i + 1) + "}"));
  }
}
const copies = [];
let wrong = 0, sum = 0;
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < sources.length; i++) {
    const assigned = assign(parse('{"first":0}'), sources[i]);
    const spreadCopy = spreadAfter(sources[i]);
    if (Object.keys(assigned).join() !== "first,p" + i + ",shared" || Object.keys(spreadCopy).join() !== "a,z,p" + i + ",shared") wrong++;
    sum += assigned["p" + i] + assigned.shared + spreadCopy["p" + i] + spreadCopy.shared;
    copies.push(assigned, spreadCopy);
  }
}
lines.push("5000 pairs of shapes: " + wrong + " wrong, sum " + sum + ", " + copies.length + " copies");

console.log(lines.join("\n"));
