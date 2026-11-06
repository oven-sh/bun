// Each copy site sees literals of one shape first, then sources that break every assumption a guarded inline copy could make.
const tag = Symbol("tag");
const hidden = Symbol("hidden");
const log = [];

function describe(value) {
  if (value === null || typeof value !== "object") return String(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const d = Reflect.getOwnPropertyDescriptor(value, key);
    const flags = (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
    const held = "value" in d ? (typeof d.value === "object" && d.value !== null ? "{..}" : typeof d.value === "function" ? "fn" : String(d.value)) : "accessor";
    parts.push(String(key) + ":" + flags + ":" + held);
  }
  const proto = Object.getPrototypeOf(value);
  return "[" + parts.join(" ") + "] proto=" + (proto === Object.prototype ? "Object" : proto === null ? "null" : proto === Array.prototype ? "Array" : "other") + (Object.isExtensible(value) ? "" : " closed");
}

class Point {
  #secret = 7;
  a = 1;
  b = 2;
  get c() { return "inherited getter"; }
  static make() { return new Point(); }
}
class Derived extends Point {
  d = 4;
  constructor() { super(); this.a = "derived"; }
}

function plain(seed) { return { a: seed, b: seed + 1, c: "c" + seed, d: seed * 2 }; }

function makeSources() {
  const withGetter = { a: 1, get b() { log.push("get b"); return "from getter"; }, c: 3, d: 4 };
  const deletesLater = { a: 1, get b() { log.push("b deletes d"); delete this.d; return 2; }, c: 3, d: 4 };
  const addsLater = { a: 1, get b() { log.push("b adds z"); this.z = 26; return 2; }, c: 3, d: 4 };
  const hidesLater = { a: 1, get b() { log.push("b hides d"); Object.defineProperty(this, "d", { enumerable: false }); return 2; }, c: 3, d: 4 };
  const rewritesLater = { a: 1, get b() { log.push("b rewrites c"); this.c = "rewritten"; return 2; }, c: 3, d: 4 };
  const throwsMidway = { a: 1, get b() { log.push("b throws"); throw new RangeError("midway"); }, c: 3, d: 4 };
  const nonEnumerable = plain(1);
  Object.defineProperty(nonEnumerable, "b", { enumerable: false });
  const readOnly = plain(2);
  Object.defineProperty(readOnly, "c", { writable: false });
  const otherOrder = { d: 1, c: 2, b: 3, a: 4 };
  const deletedAndAdded = plain(3);
  delete deletedAndAdded.a;
  deletedAndAdded.a = "again";
  const withSymbols = { a: 1, [tag]: "tagged", b: 2, c: 3, d: 4 };
  Object.defineProperty(withSymbols, hidden, { value: "hidden", enumerable: false });
  const withIndexes = { b: 1, 2: "two", a: 2, 0: "zero", c: 3, d: 4, 1: "one" };
  const ownProto = JSON.parse('{"a":1,"__proto__":{"polluted":true},"b":2,"c":3,"d":4}');
  const definedProto = plain(4);
  Object.defineProperty(definedProto, "__proto__", { value: "own", enumerable: true, writable: true, configurable: true });
  const nullProto = Object.assign(Object.create(null), plain(5));
  const inherits = Object.create(plain(6));
  inherits.own = "own only";
  const proxy = new Proxy(plain(7), {
    ownKeys(t) { log.push("ownKeys"); return ["d", "a", "b"]; },
    getOwnPropertyDescriptor(t, k) { log.push("gopd " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); },
    get(t, k) { log.push("get " + String(k)); return "proxied " + String(k); },
  });
  const frozen = Object.freeze(plain(8));
  const sealed = Object.seal(plain(9));
  const grown = plain(10);
  grown.e = 5; grown.f = 6;
  const shrunk = plain(11);
  delete shrunk.c;
  const holdsOddValues = { a: undefined, b: null, c: -0, d: NaN };
  const holdsOtherTypes = { a: "text", b: { nested: 1 }, c: 3.5, d: () => 1 };
  const big = {};
  for (let i = 0; i < 70; i++) big["k" + i] = i;
  const dictionary = {};
  for (let i = 0; i < 100; i++) dictionary["k" + i] = i;
  for (let i = 3; i < 100; i++) delete dictionary["k" + i];
  dictionary.a = "in a dictionary";
  function fn() {}
  fn.a = "on a function";
  const args = (function () { return arguments; })("x", "y");
  const boxed = Object("hi");
  boxed.a = "on a boxed string";
  const list = ["p", "q"];
  list.a = "on a list";
  const sparse = [, "hole before"];
  const map = new Map([["a", 1]]);
  map.a = "on a map";
  const error = new Error("boom");
  error.a = "on an error";
  const accessorPair = {};
  Object.defineProperty(accessorPair, "a", { get() { log.push("pair get"); return "pair"; }, set(v) { log.push("pair set"); }, enumerable: true, configurable: true });
  const setterOnly = { set a(v) { log.push("never"); }, b: 2 };
  return {
    plain: plain(0), withGetter, deletesLater, addsLater, hidesLater, rewritesLater, throwsMidway, nonEnumerable, readOnly, otherOrder, deletedAndAdded,
    withSymbols, withIndexes, ownProto, definedProto, nullProto, inherits, proxy, frozen, sealed, grown, shrunk, holdsOddValues, holdsOtherTypes, big, dictionary,
    fn, args, boxed, list, sparse, map, error, accessorPair, setterOnly, instance: new Point(), derived: new Derived(), typed: new Uint8Array([9, 8]),
    text: "str", empty: "", number: 5, bool: true, symbol: tag, bigint: 10n, undef: undefined, nul: null, emptyObject: {}, date: new Date(0), regexp: /x/g,
  };
}

const forms = {
  spread: s => ({ ...s }),
  spreadThenMember: s => ({ ...s, b: "after" }),
  memberThenSpread: s => ({ b: "before", z: 0, ...s }),
  overDefaults: s => ({ a: 0, b: 0, c: 0, d: 0, ...s }),
  twoSpreads: s => ({ ...s, ...s }),
  betweenSpreads: s => ({ ...plain(100), m: 1, ...s }),
  overAccessor: s => ({ get a() { return "literal getter"; }, set a(v) { log.push("literal setter ran"); }, ...s }),
  withProtoInLiteral: s => ({ __proto__: { inheritedFromLiteral: 1 }, ...s }),
  overMethod: s => ({ a() { return 1; }, ...s }),
  rest: s => { const { a, ...rest } = s; return rest; },
  restOfTwo: s => { const { a, c, ...rest } = s; return rest; },
  restOfMissing: s => { const { nothing, ...rest } = s; return rest; },
  restComputed: s => { const key = "b"; const { [key]: taken, ...rest } = s; return rest; },
  restSymbol: s => { const { [tag]: taken, ...rest } = s; return rest; },
  restIndex: s => { const { 0: first, ...rest } = s; return rest; },
  restParameter: s => (({ d, ...rest }) => rest)(s),
  assignEmpty: s => Object.assign({}, s),
  assignLiteral: s => Object.assign({ b: "before", z: 0 }, s),
  assignTwo: s => Object.assign({}, plain(200), s),
  assignSetter: s => Object.assign({ set a(v) { log.push("target setter a=" + String(v)); }, get a() { return "target getter"; } }, s),
  assignInheritedSetter: s => Object.assign(Object.create({ set b(v) { log.push("inherited setter b=" + String(v)); } }), s),
  assignReadOnly: s => Object.assign(Object.defineProperty({ a: 0 }, "c", { value: "fixed", writable: false, enumerable: true, configurable: true }), s),
  assignFrozen: s => Object.assign(Object.freeze({ a: 0 }), s),
  assignNonExtensible: s => Object.assign(Object.preventExtensions({ a: 0 }), s),
  assignInstance: s => Object.assign(new Point(), s),
  assignKeepsAttributes: s => Object.assign(Object.defineProperty({}, "a", { value: 0, writable: true, enumerable: false, configurable: false }), s),
};

function attempt(name, form, key, source) {
  log.length = 0;
  let shown;
  try {
    shown = describe(form(source));
  } catch (e) {
    shown = "threw " + e.constructor.name + ": " + e.message;
  }
  console.log(name, key, shown, log.length ? "| " + log.join(", ") : "");
}

for (const name in forms) {
  const form = forms[name];
  let sum = 0;
  for (let i = 0; i < 40; i++) {
    try {
      sum += Reflect.ownKeys(form(plain(i))).length;
    } catch {
      sum--;
    }
  }
  console.log(name, "warm", sum);
  const sources = makeSources();
  for (const key in sources) attempt(name, form, key, sources[key]);
  // The well-behaved shape again, after every failure.
  attempt(name, form, "plain again", plain(1));
}
