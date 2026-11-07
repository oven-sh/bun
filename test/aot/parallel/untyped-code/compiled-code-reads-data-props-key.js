// Reflect.get(object, key, receiver) and super[key] look a key up in one object for another receiver. A data property is the same for every receiver, so compiled code reads it itself, and it calls a getter with the receiver itself. It asks the run time for a getter of a built-in class, for a proxy, for an index, and the first few times.
// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const operations = ["GetByValWithThis", "SuperGet", "GetByVal", "GetByValAndCache", "GetByValGeneric", "GetById", "GetByIdAndCache", "GetGeneric", "GetWithProxyTrap", "ValidateAnswerOfProxyTrap"];
const asked = () => operations.reduce((sum, name) => sum + count("operationAOT" + name), 0);
const mark = Symbol("mark");
const readFor = (object, key, receiver) => Reflect.get(object, key, receiver);

function attempt(label, work) {
  let answer;
  try { answer = String(work()); } catch (error) { answer = "threw " + error.constructor.name + ": " + error.message; }
  console.log(label + ": " + answer);
}

function measure(label, read, bound) {
  for (let i = 0; i < 40; i++) read(i);
  const before = asked();
  let text = "";
  for (let i = 0; i < 1000; i++) text = String(read(i));
  console.log(label + ": " + text + " | " + (asked() - before <= bound));
}

const other = { name: "the receiver" };
const literal = { wanted: 1, second: "two", [mark]: 3 };
measure("fields of a literal", i => [readFor(literal, "wanted", other), readFor(literal, i & 1 ? "wanted" : "second", other), readFor(literal, mark, other)].join(" "), 20);
measure("a name that nothing has", i => [readFor(literal, "missing", other), readFor(literal, i & 1 ? "missing" : "gone", other)].join(" "), 20);
const grown = {}; for (let i = 0; i < 12; i++) grown["k" + i] = i;
measure("an object filled under keys", i => readFor(grown, "k" + (i % 12), other), 40);
const parsed = JSON.parse('{"wanted":1,"second":{"inner":2}}');
measure("a parsed object", i => [readFor(parsed, "wanted", other), readFor(parsed, "second", other).inner].join(" "), 20);
const heir = Object.create(literal); heir.own = "own";
measure("values of the object above", i => [readFor(heir, "wanted", other), readFor(heir, "own", other), readFor(heir, mark, other)].join(" "), 20);
class Base { constructor() { this.field = "field"; } method() { return "method of " + this.name; } static fixed = "static"; }
class Derived extends Base {
  constructor() { super(); this.name = "derived"; }
  method() { return "overridden"; }
  under(key) { return super[key]; }
  callUnder(key) { return super[key](); }
  static under(key) { return super[key]; }
}
const instance = new Derived;
measure("a method of a class", i => [typeof readFor(instance, "method", other), readFor(instance, "field", other), readFor(instance, "method", other).call(other)].join(" "), 20);
measure("super under a key", i => [typeof instance.under("method"), instance.callUnder("method"), instance.under("field"), Derived.under("fixed")].join(" "), 20);
measure("a trap that hands on", i => { const proxy = measure.proxy ??= new Proxy({ wanted: 1, second: 2 }, { get(target, key, receiver) { return Reflect.get(target, key, receiver); } }); return proxy.wanted + proxy.second + proxy[i & 1 ? "wanted" : "second"]; }, 20);

// What hangs on the receiver.
const withGetter = { get wanted() { return this.name; }, set only(value) {} };
const belowGetter = Object.create(withGetter);
measure("a getter gets the receiver", i => [readFor(withGetter, "wanted", other), readFor(belowGetter, "wanted", other)].join(" "), 20);
measure("a setter alone", i => readFor(withGetter, "only", other), 1000);
class WithAccessor { get wanted() { return this === other ? "the receiver" : "another"; } static get fixed() { return this === BelowAccessor; } }
class BelowAccessor extends WithAccessor { get wanted() { return "lower"; } under(key) { return super[key]; } static under(key) { return super[key]; } }
measure("a getter of a class", i => [readFor(new WithAccessor, "wanted", other), new BelowAccessor().under("wanted"), BelowAccessor.under("fixed")].join(" "), 20);
const defined = Object.defineProperty({}, "wanted", { get() { return "defined for " + this.name; }, configurable: true });
measure("a getter that was defined", i => [readFor(defined, "wanted", other), readFor(Object.create(defined), "wanted", other)].join(" "), 20);
const list = [1, 2, 3];
measure("the length of an array", i => { if (i === 500) list.push(4); return readFor(list, "length", other); }, 20);
const strictGetter = { get wanted() { "use strict"; return typeof this; } };
const sloppyGetter = { get wanted() { return typeof this; } };
for (const receiver of [other, 1, "text", null, undefined, mark, true, 10n])
  attempt("receiver " + String(receiver && typeof receiver === "object" ? "object" : String(receiver)), () => { let text; for (let i = 0; i < 40; i++) text = [readFor(literal, "wanted", receiver), readFor(strictGetter, "wanted", receiver), readFor(sloppyGetter, "wanted", receiver)].join(" "); return text; });
const throwing = { get wanted() { throw new RangeError("from the getter for " + this.name); } };
attempt("a getter that throws", () => { let caught = 0; for (let i = 0; i < 40; i++) try { readFor(throwing, "wanted", other); } catch (error) { if (error.message === "from the getter for the receiver") caught++; } return caught; });
const getters = { native: Object.prototype.valueOf, bound: function () { return this; }.bind(literal), proxy: new Proxy(function () { return this; }, {}), arrow: () => other, withParameters: function (a, b) { return a === undefined && b === undefined && this; }, async: async function () { return 1; }, generator: function* () {} };
for (const kind in getters) {
  const holder = Object.defineProperty({}, "wanted", { get: getters[kind] });
  attempt("a getter that is " + kind, () => { let answer; for (let i = 0; i < 40; i++) answer = readFor(holder, "wanted", other); return answer === other ? "the receiver" : answer === literal ? "the literal" : Object.prototype.toString.call(answer); });
}
let depth = 0;
const recursive = { get wanted() { return depth++ < 5 ? readFor(recursive, "wanted", this) + 1 : 0; } };
attempt("a getter that reads again", () => { let answer; for (let i = 0; i < 40; i++) { depth = 0; answer = readFor(recursive, "wanted", other); } return answer; });
const endless = { get wanted() { return readFor(endless, "wanted", this); } };
attempt("a getter without an end", () => { try { return readFor(endless, "wanted", other); } catch (error) { return error.constructor.name; } });

// A field that one object lacks, above which a getter waits.
function Optional(has) { if (has) this.sometimes = "own"; this.always = 1; }
Object.defineProperty(Optional.prototype, "sometimes", { get() { return "getter for " + this.name; }, configurable: true });
for (let round = 0; round < 3; round++) for (const has of [true, false, true, false]) attempt("an optional field, " + has, () => readFor(new Optional(has), "sometimes", other));
const removed = { wanted: 1, kept: 2 }; for (let i = 0; i < 50; i++) readFor(removed, "wanted", other);
delete removed.wanted; attempt("behind a delete", () => [readFor(removed, "wanted", other), readFor(removed, "kept", other)].join(" "));
Object.setPrototypeOf(removed, { get wanted() { return "from above for " + this.name; } }); attempt("behind a new prototype", () => readFor(removed, "wanted", other));
const redefined = { wanted: 1 }; for (let i = 0; i < 50; i++) readFor(redefined, "wanted", other);
Object.defineProperty(redefined, "wanted", { get() { return "now a getter for " + this.name; } }); attempt("behind a definition", () => readFor(redefined, "wanted", other));
const above = { late: undefined }; delete above.late; const below = Object.create(above); for (let i = 0; i < 50; i++) readFor(below, "late", other);
above.late = "arrived"; attempt("a name that arrives above", () => readFor(below, "late", other));
Object.defineProperty(below, "late", { get() { return "own getter for " + this.name; } }); attempt("a getter that arrives", () => readFor(below, "late", other));

// Keys of every kind.
const many = { 0: "zero", 1.5: "fraction", "-1": "negative", "": "empty", null: "null", undefined: "undefined", true: "true", wanted: 1, [mark]: "marked" };
for (let round = 0; round < 3; round++)
  for (const key of [0, "0", 1.5, -1, "", null, undefined, true, "wan" + "ted", mark, { toString() { return "wanted"; } }, ["wanted"], 4294967295, -0])
    attempt("key " + String(typeof key === "symbol" ? "a symbol" : typeof key + " " + String(key)), () => readFor(many, key, other));
attempt("a key that throws", () => readFor(many, { toString() { throw new RangeError("no key"); } }, other));
for (const target of [[1, 2, 3], "text", 1, null, undefined, function named() {}, new Map, new Uint8Array(2), new String("boxed"), Object.create(null)])
  for (const key of ["length", 0, "name", "size", "missing"])
    attempt("target " + Object.prototype.toString.call(target) + " key " + key, () => readFor(target, key, other));
attempt("size for the map itself", () => { const map = new Map([[1, 2]]); return readFor(map, "size", map); });
const inner = new Proxy({ wanted: 1 }, { get(target, key, receiver) { return String(key) + " for " + receiver.name; } });
for (let round = 0; round < 3; round++) attempt("a proxy as the object", () => [readFor(inner, "wanted", other), readFor(Object.create(inner), "missing", other), readFor(new Proxy(literal, {}), "wanted", other), readFor(new Proxy(withGetter, {}), "wanted", other)].join(" "));
attempt("two arguments", () => [Reflect.get(literal, "wanted"), Reflect.get(withGetter, "wanted"), Reflect.get({ name: "itself", get wanted() { return this.name; } }, "wanted")].join(" "));
const nothingAbove = { __proto__: null, under(key) { return super[key]; } };
attempt("super above nothing", () => { try { return nothingAbove.under("wanted"); } catch (error) { return error.constructor.name; } });
const moved = { under(key) { return super[key]; } }; Object.setPrototypeOf(moved, { wanted: "first" }); for (let i = 0; i < 50; i++) moved.under("wanted");
Object.setPrototypeOf(moved, { wanted: "second" }); attempt("super behind a new prototype", () => moved.under("wanted"));
Object.setPrototypeOf(moved, { get wanted() { return this === moved; } }); attempt("super meets a getter", () => moved.under("wanted"));
