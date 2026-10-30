// `new` of a constructor function that a variable holds asks the function for its `prototype` each time: the same function many times, functions in turn,
// a prototype that is replaced, one that is no object, another new.target, and all of it again after a collection.
function given<T>(text: string): T { return JSON.parse(text) as T; }
type Maker = new (kind: number, name: string) => { kind: number; name: string; describe?: () => string };
function Leaf(this: { kind: number; name: string }, kind: number, name: string) { this.kind = kind; this.name = name; }
function Branch(this: { kind: number; name: string; children: unknown[] }, kind: number, name: string) { this.kind = kind; this.name = name; this.children = []; }
function Plain(this: { kind: number; name: string }, kind: number, name: string) { this.kind = kind; this.name = name; }
Leaf.prototype.describe = function (this: { name: string }) { return "leaf " + this.name; };
Branch.prototype.describe = function (this: { name: string }) { return "branch " + this.name; };
const makers = { leaf: Leaf as unknown as Maker, branch: Branch as unknown as Maker, plain: Plain as unknown as Maker };
function make(maker: Maker, kind: number, name: string) { return new maker(kind, name); }
function show(made: { kind: number; name: string; describe?: () => string }, ...candidates: Function[]): string {
  const prototype = Object.getPrototypeOf(made);
  const of = candidates.findIndex(candidate => candidate.prototype === prototype);
  return `${made.kind}:${made.name}:${made.describe ? made.describe() : "-"}:${of}:${prototype === Object.prototype}:${Object.keys(made).join()}`;
}
const all = [Leaf, Branch, Plain];

// One function many times, then the three in turn.
let count = 0; for (let i = 0; i < 3000; i++) count += make(makers.leaf, i, "n") instanceof Leaf ? 1 : 0;
console.log(count, show(make(makers.leaf, 1, "a"), ...all), show(make(makers.branch, 2, "b"), ...all), show(make(makers.plain, 3, "c"), ...all));
const order = given<(keyof typeof makers)[]>('["leaf","branch","plain","branch","leaf","plain","plain"]');
console.log(order.map((name, index) => show(make(makers[name], index, name), ...all)).join(" "));

// The prototype is replaced: what is made afterwards has the new one, what was made before keeps the old one.
const before = make(makers.plain, 4, "before");
const replaced = { describe(this: { name: string }) { return "replaced " + this.name; } };
Plain.prototype = replaced;
const after = make(makers.plain, 5, "after");
console.log(show(before, ...all), show(after, ...all), Object.getPrototypeOf(after) === replaced, before instanceof Plain, after instanceof Plain);
for (let i = 0; i < 100; i++) make(makers.plain, i, "warm");
Plain.prototype = { describe() { return "again"; } };
console.log(show(make(makers.plain, 6, "x"), ...all));

// A prototype that is no object: the object gets Object.prototype.
for (const value of [undefined, null, 1, "text", true, Symbol.iterator, 2n]) {
  (Plain as { prototype: unknown }).prototype = value;
  console.log(String(typeof value), show(make(makers.plain, 7, "none"), ...all));
}
Plain.prototype = replaced;
console.log(show(make(makers.plain, 8, "back"), ...all));

// Properties added to the function move its `prototype` property to another place, or leave it where it is.
const decorated = Branch as unknown as Record<string, unknown>;
for (let i = 0; i < 12; i++) { decorated["extra" + i] = i; console.log(i, show(make(makers.branch, i, "d"), ...all)); }
delete decorated.extra3; console.log(show(make(makers.branch, 13, "deleted"), ...all));

// Another new.target.
class Heir extends (Leaf as unknown as Maker) { extra = 1; }
function Other() {}
console.log(show(new Heir(9, "heir"), Leaf, Heir), show(Reflect.construct(Leaf, [10, "reflected"], Other), Leaf, Other), show(Reflect.construct(Leaf, [11, "branch"], Branch), Leaf, Branch));
const bound = (Leaf as Function).bind(null, 12) as unknown as new (name: string) => { kind: number; name: string };
console.log(show(new bound("bound"), Leaf), show(Reflect.construct(bound, ["bound too"], Other), Leaf, Other));
let reads = 0;
const watched = new Proxy(Leaf, { get(target, key, receiver) { if (key === "prototype") reads++; return Reflect.get(target, key, receiver); } }) as unknown as Maker;
console.log(show(make(watched, 13, "proxy"), Leaf), reads, show(Reflect.construct(Branch, [14, "by proxy"], watched), Leaf, Branch), reads);

// Closures of one function text: each has a prototype of its own.
function family(tag: string): Maker {
  function Member(this: { kind: number; name: string }, kind: number, name: string) { this.kind = kind; this.name = tag + name; }
  Member.prototype.describe = function (this: { name: string }) { return tag + "!" + this.name; };
  return Member as unknown as Maker;
}
const families = ["p", "q", "r", "s", "t", "u", "v", "w", "x", "y"].map(family);
console.log(families.map((member, index) => show(make(member, index, "m"), ...families)).join(" "));
console.log(families.map((member, index) => make(member, index, "m") instanceof families[(index + 1) % families.length]).join());

// Collections in between.
let kept = 0;
for (let round = 0; round < 4; round++) {
  Bun.gc(true);
  for (let i = 0; i < 500; i++) kept += (make(families[i % families.length], i, "g").describe!().length + (make(makers.leaf, i, "g") instanceof Leaf ? 1 : 0));
}
console.log(kept);
