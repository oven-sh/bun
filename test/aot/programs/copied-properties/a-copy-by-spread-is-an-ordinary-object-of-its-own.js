// `{ ...source }` makes an ordinary object: its own cell, Object.prototype above it, every property writable, enumerable and configurable,
// whatever the source is, whatever was done to the source before, and whatever is done to either of them afterwards.
const lines = [];
function show(name, value) { lines.push(name + ": " + value); }
function describe(object) {
  const names = Reflect.ownKeys(object).map(key => {
    const d = Object.getOwnPropertyDescriptor(object, key);
    return String(key) + "=" + ("value" in d ? (typeof d.value === "object" && d.value ? "{" + Object.keys(d.value) + "}" : String(d.value)) : "accessor") + (d.writable ? "w" : "-") + (d.enumerable ? "e" : "-") + (d.configurable ? "c" : "-");
  });
  return names.join(" ") + " | " + (Object.getPrototypeOf(object) === Object.prototype ? "Object.prototype" : "another prototype") + " | " + (Object.isExtensible(object) ? "extensible" : "not extensible");
}
function copy(source) { return { ...source }; }
function copyAndAdd(source, value) { return { ...source, added: value }; }
function copyAndOverride(source, value) { return { ...source, a: value }; }
function copyTwice(source) { const first = { ...source }; const second = { ...first }; return [first, second]; }

function plain(i) { return { a: i, b: "b" + i, c: i + 0.5 }; }
for (let i = 0; i < 3; i++) {
  const source = plain(i);
  const made = copy(source);
  show("plain " + i, describe(made) + " | same cell " + (made === source));
  made.a = "changed"; made.later = 1;
  show("the source behind a store to the copy " + i, describe(source));
  source.b = "changed too"; delete source.c;
  show("the copy behind a store to the source " + i, describe(made));
  show("added " + i, describe(copyAndAdd(plain(i), i * 2)));
  show("overridden " + i, describe(copyAndOverride(plain(i), "over")));
  const [first, second] = copyTwice(plain(i));
  first.a = -1;
  show("twice " + i, describe(first) + " || " + describe(second));
}

const above = { inherited() { return "from above"; }, a: "hidden" };
function withPrototype(i) { return { __proto__: above, a: i, b: i + 1 }; }
for (let i = 0; i < 3; i++) {
  const made = copy(withPrototype(i));
  show("a source with a prototype " + i, describe(made) + " | " + typeof made.inherited);
}

class Point { constructor(x, y) { this.x = x; this.y = y; } get sum() { return this.x + this.y; } norm() { return this.x * this.y; } }
for (let i = 0; i < 3; i++) {
  const made = copy(new Point(i, i + 1));
  show("an instance " + i, describe(made) + " | " + (made instanceof Point) + " " + typeof made.norm + " " + made.sum);
}

function frozen(i) { return Object.freeze({ a: i, b: i }); }
function sealed(i) { return Object.seal({ a: i, b: i }); }
function closed(i) { return Object.preventExtensions({ a: i, b: i }); }
for (let i = 0; i < 3; i++) {
  for (const make of [frozen, sealed, closed]) {
    const made = copy(make(i));
    made.a = "stored"; made.extra = true; delete made.b;
    show(make.name + " " + i, describe(made));
  }
}

function hidden(i) { const o = { a: i, b: i, c: i }; Object.defineProperty(o, "b", { enumerable: false }); return o; }
function readOnly(i) { const o = { a: i, b: i }; Object.defineProperty(o, "a", { writable: false }); return o; }
function redefined(i) { const o = { a: i, b: i }; Object.defineProperty(o, "a", { get() { return "got " + i; }, enumerable: true, configurable: true }); return o; }
function withGetter(i) { let reads = 0; return { a: i, get b() { return "read " + ++reads; }, c: i }; }
function withSetter(i) { return { a: i, set b(v) { lines.push("THE SETTER RAN"); }, c: i }; }
for (let i = 0; i < 3; i++) {
  for (const make of [hidden, readOnly, redefined, withGetter, withSetter]) {
    const made = copy(make(i));
    show(make.name + " " + i, describe(made));
    made.a = "stored"; made.b = "stored";
    show(make.name + " stored " + i, describe(made));
  }
}

const mark = Symbol("mark");
function withSymbol(i) { return { a: i, [mark]: i, b: i }; }
function withIndexes(i) { return { b: i, 1: "one", a: i, 0: "zero" }; }
function withDeleted(i) { const o = { a: i, b: i, c: i }; delete o.a; return o; }
function withDeletedAndBack(i) { const o = { a: i, b: i, c: i }; delete o.a; o.a = "back"; return o; }
function withLater(i) { const o = { a: i, b: i }; o.later = i; o["l" + i] = i; return o; }
function otherOrder(i) { return i & 1 ? { a: i, b: i } : { b: i, a: i }; }
function sometimes(i) { const o = { a: i }; if (i & 1) o.b = i; return o; }
function proto(i) { return { a: i, ["__proto__"]: "own", b: i }; }
for (let i = 0; i < 4; i++) {
  for (const make of [withSymbol, withIndexes, withDeleted, withDeletedAndBack, withLater, otherOrder, sometimes, proto])
    show(make.name + " " + i, describe(copy(make(i))) + " || " + describe(copyAndAdd(make(i), i)) + " || " + describe(copyAndOverride(make(i), "over")));
}

for (let i = 0; i < 3; i++) {
  for (const source of [undefined, null, 0, i, "ab", true, mark, 10n, [i, i + 1], () => i, new Map([[1, 2]]), new Proxy({ a: i, b: i }, { ownKeys() { return ["b", "a"]; } }), Object.create(null), Object.create({ a: 1 }), Object.assign(Object.create(null), { a: i })])
    show("another source " + i, describe(copy(source)));
}

console.log(lines.join("\n"));
