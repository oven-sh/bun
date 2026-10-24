// Keyed property caches with symbol keys and string keys built at run time: reads, `in`, stores, class field definitions and private fields each run in a loop until they are cached, then the cached answer is invalidated.
const turns = JSON.parse("40");
const box = JSON.parse("[0]");
function hidden(value) { box[0] = value; return box[0]; }
function said(run) { try { return String(run()); } catch (error) { return "threw " + error.constructor.name; } }
const lines = [];
function say(what, ...values) { lines.push(what + ": " + values.map(String).join(" ")); }

const built = parts => parts.join("");
const keyParts = JSON.parse('["to","ken"]');
const reusedString = built(keyParts);
const secondKey = built(JSON.parse('["sec","ond"]'));
const localSymbol = Symbol("s");
const registeredSymbol = Symbol.for("registered");
const keyKinds = [
  ["new string", () => built(keyParts)],
  ["reused string", () => reusedString],
  ["symbol", () => localSymbol],
  ["registered symbol", () => registeredSymbol],
];

function read(o, key) {
  const answers = new Set();
  for (let i = 0; i < turns; i++) answers.add(String(o[key]));
  return [...answers].join("|");
}
function has(o, key) {
  const answers = new Set();
  for (let i = 0; i < turns; i++) answers.add(key in o);
  return [...answers].join("|");
}
function write(o, key, value) {
  for (let i = 0; i < turns; i++) o[key] = value + i;
}
function writeEach(objects, key, value) {
  for (let i = 0; i < objects.length; i++) objects[i][key] = value + i;
}
function createWithNames(prototype, count) {
  const o = Object.create(prototype);
  for (let i = 0; i < count; i++) o["p" + i] = i;
  return o;
}
function createEachWithNames(prototype, count) {
  const objects = [];
  for (let i = 0; i < turns; i++) objects.push(createWithNames(prototype, count));
  return objects;
}
function describe(o) {
  return Reflect.ownKeys(o).map(key => String(key) + "=" + String(o[key])).join();
}

function readCases(kind, key) {
  const readAndTest = o => read(o, key()) + " " + has(o, key());
  const holder = Object.create(null);
  const owner = Object.create(holder);
  const child = Object.create(holder);
  const prototype = Object.create(null);
  const receiver = Object.create(prototype);
  const withoutPrototype = Object.create(null);
  holder[key()] = "inherited";
  owner[key()] = "own";
  say(kind + ", own", readAndTest(owner));
  say(kind + ", inherited", readAndTest(child));
  say(kind + ", absent", readAndTest(receiver), readAndTest(withoutPrototype));
  holder.unrelated = 1;
  prototype.unrelated = 1;
  say(kind + ", unrelated name added to the prototypes", readAndTest(child), readAndTest(receiver));
  prototype[key()] = "prototype";
  say(kind + ", absent becomes inherited", readAndTest(receiver));
  receiver[key()] = "receiver";
  say(kind + ", inherited becomes own", readAndTest(receiver));
  delete receiver[key()];
  delete prototype[key()];
  say(kind + ", deleted from both", readAndTest(receiver));
  Object.defineProperty(prototype, key(), { get() { return "prototype getter"; }, configurable: true });
  say(kind + ", getter on the prototype", readAndTest(receiver));
  Object.defineProperty(receiver, key(), { get() { return "own getter"; }, configurable: true });
  say(kind + ", getter on the receiver", readAndTest(receiver));
  withoutPrototype[key()] = "stored";
  say(kind + ", absent without a prototype becomes own", readAndTest(withoutPrototype));
}

function storeCases(kind, key) {
  const prototype = Object.create(null);
  const target = createWithNames(prototype, 2);
  write(target, key(), 100);
  write(target, key(), 200);
  say(kind + ", replaced", describe(target));
  Object.defineProperty(target, key(), { writable: false });
  say(kind + ", read-only", said(() => write(target, key(), 300)), describe(target));
  for (const earlierNames of [2, 6, 10, 14]) {
    const objects = createEachWithNames(prototype, earlierNames);
    writeEach(objects, key(), 0);
    writeEach(objects, secondKey, 1000);
    say(kind + ", added after " + earlierNames + " names", describe(objects[turns - 1]));
  }
  let setterCalls = 0;
  Object.defineProperty(prototype, key(), { set(value) { setterCalls++; }, configurable: true });
  const belowSetter = createEachWithNames(prototype, 6);
  writeEach(belowSetter, key(), 0);
  say(kind + ", stored below a prototype setter", setterCalls, Object.hasOwn(belowSetter[turns - 1], key()));
}

function Returns(o) { return o; }
function definitionCases(kind, key) {
  let setterCalls = 0;
  class Defines { [key] = 1; }
  class Redefines extends Returns { [key] = 3; }
  Object.defineProperty(Defines.prototype, key, { set(value) { setterCalls++; }, configurable: true });
  let defined;
  for (let i = 0; i < turns; i++) defined = new Defines();
  say(kind + ", field defined below a setter", setterCalls, Object.hasOwn(defined, key), defined[key]);
  for (let i = 0; i < turns; i++) defined = new Redefines(Object.create(Defines.prototype));
  say(kind + ", field defined on an ordinary object below a setter", setterCalls, Object.hasOwn(defined, key), defined[key]);
  const stored = Object.create(Defines.prototype);
  write(stored, key, 2);
  say(kind + ", stored below the same setter", setterCalls, Object.hasOwn(stored, key));

  const objects = [];
  for (let i = 0; i < turns; i++) objects.push(Object.defineProperty(Object.create(null), key, { value: 0, writable: true, configurable: true }));
  const last = objects[turns - 1];
  writeEach(objects, key, 10);
  say(kind + ", stored to a non-enumerable property", last[key], Object.getOwnPropertyDescriptor(last, key).enumerable, "[" + Object.keys(last).join() + "]");
  for (let i = 0; i < turns; i++) new Redefines(objects[i]);
  say(kind + ", field defined over it", last[key], Object.getOwnPropertyDescriptor(last, key).enumerable, "[" + Object.keys(last).join() + "]");
}

for (const [kind, key] of keyKinds) {
  readCases(kind, key);
  storeCases(kind, key);
}
definitionCases("string", built(keyParts));
definitionCases("symbol", Symbol("s"));

class Stamp extends Returns { #mark = 1; static has(o) { return #mark in o; } static read(o) { return o.#mark; } }
class Gauge { get level() { return 1; } set level(value) {} }
const stamped = [];
for (let i = 0; i < turns; i++) stamped.push(new Stamp(new Gauge()));
let marks = 0;
for (let i = 0; i < turns; i++) if (Stamp.has(stamped[i])) marks += Stamp.read(stamped[i]);
say("private field, added to instances of a class with accessors", marks, stamped[0].level);
say("private field, added twice", said(() => new Stamp(stamped[0])));
let unmarked = 0;
for (let i = 0; i < turns; i++) if (!Stamp.has(new Gauge())) unmarked++;
say("private field, absent", unmarked, said(() => Stamp.read(new Gauge())));
const inheritsFromStamped = Object.create(new Stamp({}));
let inheritedMarks = 0;
for (let i = 0; i < turns; i++) if (Stamp.has(inheritsFromStamped)) inheritedMarks++;
Bun.gc(true);
say("private field, only on the prototype", inheritedMarks, said(() => Stamp.read(inheritsFromStamped)));

class Box { fill() { this.content = 1; } }
const contentKey = built(JSON.parse('["con","tent"]'));
const instance = hidden(new Box());
say("optional field, absent", has(instance, contentKey), read(instance, contentKey));
instance.fill();
say("optional field, present", has(instance, contentKey), read(instance, contentKey));
delete instance[contentKey];
say("optional field, deleted", has(instance, contentKey), read(instance, contentKey));

console.log(lines.join("\n"));
