// A read, an `in` and a hasOwn under a name or a symbol, on objects whose shape is met for the first time (a prototype made anew each turn), through the prototypes of the engine:
// those that list their members in a static table and put each into their property table at its first read, before and after a member is shadowed, deleted, replaced or made an accessor.
const lines = [];
const show = value => typeof value === "function" ? "function " + value.name : typeof value === "symbol" ? value.toString() : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) : String(value);
const attempt = f => { try { return show(f()); } catch (error) { return "throws " + error.name; } };
const own = Symbol("own"), above = Symbol("above"), never = Symbol("never"), registered = Symbol.for("registered"), nameless = Symbol();
const names = ["next", "return", "throw", "constructor", "toString", "valueOf", "hasOwnProperty", "then", "map", "size", "get", "length", "name", "exec", "flags", "getTime", "description", "missing", "", "0", "__proto__"];
const symbols = [Symbol.iterator, Symbol.asyncIterator, Symbol.toStringTag, Symbol.toPrimitive, Symbol.hasInstance, Symbol.species, Symbol.unscopables, Symbol.match, Symbol.replace, own, above, never, registered, nameless];
function read(object, key) { return object[key]; }
function readNext(object) { return object.next; }
function readReturn(object) { return object.return; }
function readIterator(object) { return object[Symbol.iterator]; }
function readAsyncIterator(object) { return object[Symbol.asyncIterator]; }
function readTag(object) { return object[Symbol.toStringTag]; }
function has(object, key) { return key in object; }
function hasOwn(object, key) { return Object.hasOwn(object, key); }
const bases = {
  generator: () => (function* () { yield 1; })(),
  asyncGenerator: () => (async function* () { yield 1; })(),
  generatorPrototype: () => Object.getPrototypeOf(function* () {}).prototype,
  asyncGeneratorPrototype: () => Object.getPrototypeOf(async function* () {}).prototype,
  arrayIterator: () => [][Symbol.iterator](), mapIterator: () => new Map().entries(), setIterator: () => new Set().values(), stringIterator: () => ""[Symbol.iterator](), regExpStringIterator: () => "a".matchAll(/a/g),
  iteratorHelper: () => [1].values().map(x => x), array: () => [], map: () => new Map(), set: () => new Set(), weakMap: () => new WeakMap(), promise: () => Promise.resolve(1), regExp: () => /a/g, date: () => new Date(0),
  error: () => new RangeError("r"), symbolObject: () => Object(Symbol("s")), number: () => new Number(1), string: () => new String("ab"), boolean: () => new Boolean(true), bigint: () => Object(1n), fn: () => function f() {}, arrow: () => () => 1,
  bytes: () => new Uint8Array(2), buffer: () => new ArrayBuffer(2), view: () => new DataView(new ArrayBuffer(2)), math: () => Math, json: () => JSON, reflect: () => Reflect, intl: () => Intl, plain: () => ({}), bare: () => Object.create(null),
  classInstance: () => new (class A { get [above]() { return "getter of a class"; } next() { return 1; } static [own] = 1; })(), record: () => ({ next: 1, [own]: 2 }),
};
function round(title) {
  let hash = 0; const mix = text => { for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 31) + text.charCodeAt(i)) | 0; };
  for (const [kind, make] of Object.entries(bases)) {
    const before = hash;
    for (let depth = 0; depth < 3; depth++) {
      let object = make();
      for (let i = 0; i < depth; i++) { object = Object.create(object); if (i === 1) { object[own] = "own symbol"; object.extra = 1; } }
      for (const key of [...names, ...symbols]) mix(attempt(() => read(object, key)) + "|" + attempt(() => has(object, key)) + "|" + attempt(() => hasOwn(object, key)) + ";");
      mix([readNext, readReturn, readIterator, readAsyncIterator, readTag].map(f => attempt(() => f(object))).join());
    }
    lines.push(title + " " + kind + " " + (hash - before | 0));
  }
}
round("as made");
const generatorPrototype = bases.generatorPrototype(), asyncGeneratorPrototype = bases.asyncGeneratorPrototype(), iteratorPrototype = Object.getPrototypeOf(generatorPrototype), asyncIteratorPrototype = Object.getPrototypeOf(asyncGeneratorPrototype);
for (const [title, change] of [
  ["a symbol above", () => { iteratorPrototype[above] = "on the iterators' prototype"; asyncIteratorPrototype[above] = "on the async iterators' prototype"; }],
  ["a getter under a symbol", () => { Object.defineProperty(iteratorPrototype, registered, { get() { return "getter sees " + show(this); }, configurable: true }); }],
  ["a name on the iterators' prototype", () => { iteratorPrototype.missing = "no longer"; asyncIteratorPrototype.missing = "async"; }],
  ["taken away again", () => { delete iteratorPrototype[above]; delete asyncIteratorPrototype[above]; delete iteratorPrototype[registered]; delete iteratorPrototype.missing; delete asyncIteratorPrototype.missing; }],
]) { lines.push(title + ": " + attempt(change)); round(title); }
for (let turn = 0; turn < 40; turn++) {
  const f = function* () { yield turn; }, g = async function* () { yield turn; };
  const a = f(), b = g();
  if (turn % 4 === 1) f.prototype.next = function shadow() { return { done: true, value: "shadowed" }; };
  if (turn % 4 === 2) { f.prototype[Symbol.iterator] = function other() { return [7][Symbol.iterator](); }; g.prototype[Symbol.asyncIterator] = 5; }
  if (turn % 4 === 3) { a.return = "own"; Object.setPrototypeOf(b, null); }
  if (turn % 8 === 0 || turn > 35) lines.push(turn + " " + [readNext(a), readReturn(a), readIterator(a), readTag(a), readNext(b), readReturn(b), readAsyncIterator(b), readTag(b)].map(show).join() + " " + attempt(() => [...a].join()) + " " + (Object.getPrototypeOf(a) === f.prototype) + (a instanceof f));
  else lines.push(turn + " " + attempt(() => readNext(a).call(a).value) + attempt(() => [...a].join()) + show(readReturn(a)) + show(readAsyncIterator(b)) + show(readNext(b)));
}
console.log(lines.join("\n"));
