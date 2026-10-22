function print(a, b, c) { let s = "" + a; if (b !== undefined) s += " " + b; if (c !== undefined) s += " " + c; console.log(s); }
let log = 0;
function note(x) { log = x; }

// The callback and the iterable are one function object.
function both(x) { note("mapped"); return "m" + x; }
both[Symbol.iterator] = function* () { note("iterated"); yield 1; yield 2; };
print("from", Array.from(both, both).join(), log);

// Search value and replacement are one object: @@replace is read from the first operand, the second is converted.
const pattern = { [Symbol.replace](text, replacement) { note("replace"); return text + String(replacement); }, toString() { note("converted"); return "!"; } };
print("replace", "abc".replace(pattern, pattern), log);

// Target and handler of a proxy are one object.
const self = { v: 1, get(target, key) { note("trap"); return key === "v" ? "trapped" : undefined; } };
print("proxy", new Proxy(self, self).v, log);

// Prototype and descriptor map are one object.
const described = { x: { get value() { note("descriptor"); return "x"; }, enumerable: true } };
const created = Object.create(described, described);
print("create", created.x, log);
print("create inherits", typeof Object.getPrototypeOf(created).x, Object.keys(created).join());

// Both reactions are one function.
let calls = 0;
function reaction(v) { calls++; return typeof v; }
Promise.resolve(1).then(reaction, reaction).then(t => print("fulfilled", t, calls));
Promise.reject("r").then(reaction, reaction).then(t => print("rejected", t, calls));

// Callee, this and argument list are one value.
function list() { note("called"); return this === list ? arguments.length : -1; }
list.length2 = 0;
print("apply", Reflect.apply(list, list, [list, list]), log);

// Target and receiver are one object with an accessor.
const account = { _v: 5, get v() { note("getter"); return this._v; }, set v(x) { note("setter"); this._v = x; } };
print("get", Reflect.get(account, "v", account), log);
print("set", Reflect.set(account, "v", "stored", account), log);
print("after set", account._v);

// Value and replacer are one function.
function replacer(key, value) { note("replacer"); return key === "" ? { a: 1 } : value; }
replacer.toJSON = function () { note("toJSON"); return { b: 2 }; };
print("stringify", JSON.stringify(replacer, replacer), log);

// Source and target are one object with a getter and a setter.
const mirrored = { get a() { note("read a"); return 1; }, set a(x) { note("wrote a"); } };
Object.assign(mirrored, mirrored);
print("assign", log);

// Constructor and new.target are one class.
class Point { constructor(x) { note(new.target === Point ? "same" : "other"); this.x = x; } }
print("construct", Reflect.construct(Point, ["late"], Point).x, log);

// An array is concatenated with itself, and is spreadable by a late symbol.
const spread = [1, 2];
print("concat", spread.concat(spread).length);
const arrayLike = { length: 1, 0: "late", [Symbol.isConcatSpreadable]: true };
print("concat like", [].concat(arrayLike, arrayLike).join());

// The comparator is also an element.
function compare(a, b) { note("compared"); return 0; }
print("sort", [compare, compare].sort(compare).length, log);

// Bound function: target, this and argument are one function.
function echo(a) { return this === echo && a === echo; }
print("bind", echo.bind(echo, echo)());
