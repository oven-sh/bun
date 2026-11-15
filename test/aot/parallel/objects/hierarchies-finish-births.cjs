// Reads of the fields of a class with subclasses, whatever becomes of the object and whichever constructor hands it out early.
"use strict";
const out = [];
const show = (f) => { try { const r = f(); return r && typeof r === "object" ? JSON.stringify(r) : String(r); } catch (error) { return error.constructor.name; } };
globalThis.early = [];
globalThis.watch = null;
class Node {
  constructor(kind, pos, end) {
    this.pos = pos;
    this.end = end;
    this.kind = kind;
    this.parent = undefined;
    if (globalThis.watch) globalThis.watch(this);
    if (kind === 99) throw new RangeError("kind");
  }
  width() { let t = 0; for (let i = 0; i < 4; i++) t += this.end - this.pos; return t; }
  describe() { return [this.kind, this.pos, this.end, this.width()].join(":"); }
}
class Token extends Node {
  constructor(kind, pos, end) { super(kind, pos, end); this.text = "t" + pos; }
  describe() { return super.describe() + this.text; }
}
class Identifier extends Token {
  original = 1;
  constructor(pos, end, name) { super(80, pos, end); this.name = name; this.flags = pos | 0; }
  describe() { return super.describe() + this.name + this.flags + this.original; }
}
class Literal extends Node { value = 5; }
class Alias extends Literal { constructor(kind, pos, end) { super(kind, pos, end); if (pos === 3) return { pos: 7, end: 9, kind: 1, describe() { return "another"; } }; this.pos += 0; } }
function Base(a) { this.a = a; this.b = a; }
Base.prototype.sum = function () { let t = 0; for (let i = 0; i < 3; i++) t += this.a + this.b; return t; };
function Heir(a) { Base.call(this, a); this.c = 1; }
Heir.prototype = Object.create(Base.prototype);
Heir.prototype.constructor = Heir;
function total(nodes) { let t = 0; for (let i = 0; i < nodes.length; i++) { const node = nodes[i]; t += node.end - node.pos + node.kind; if (node.parent) t++; } return t; }
function link(nodes, parent) { for (const node of nodes) { node.parent = parent; node.end++; } }
const make = (n) => [new Node(1, n, n + 2), new Token(2, n, n + 3), new Identifier(n, n + 4, "x"), new Literal(4, n, n + 5), new Alias(5, n, n + 6)];
for (let n = 0; n < 5; n++) { const nodes = make(n); out.push(total(nodes)); link(nodes, nodes[0]); out.push(total(nodes), nodes.map((node) => node.describe()).join(" "), nodes.map((node) => Object.keys(node).join()).join(" ")); }
for (const o of [new Base(2), new Heir(3), Reflect.construct(Base, [4], Heir), Object.create(Heir.prototype)]) out.push(o.sum() + Object.keys(o).join());
// An object that a constructor hands out early, and one whose constructor never ends.
globalThis.watch = (node) => { globalThis.early.push(node); out.push(Object.keys(node).join() + show(() => total([node])) + show(() => node.describe())); };
for (const f of [() => new Identifier(1, 2, "early"), () => new Token(99, 1, 2), () => new Alias(99, 3, 4), () => new Alias(5, 3, 4), () => new Literal(6, 1, 2)]) out.push(show(() => f().describe()));
globalThis.watch = null;
for (const node of globalThis.early) out.push(Object.keys(node).join() + show(() => total([node])) + show(() => node.describe()));
// Nothing but the program at run time knows this text.
const fates = (0, eval)(`({
  nothing(n) {}, deleted(n) { del§ete n.pos; }, deletedText(n) { del§ete n.text; }, again(n) { del§ete n.end; n.end = 30; }, frozen(n) { Ob§ject.freeze(n); }, closed(n) { del§ete n.kind; Ob§ject.preventExtensions(n); },
  locked(n) { Ob§ject.defineProperty(n, "end", { writable: false }); }, accessor(n) { let held = 2; Ob§ject.defineProperty(n, "pos", { get() { return held++; }, set(v) { held = v + 1; }, configurable: true, enumerable: true }); },
  above(n) { del§ete n.pos; Ob§ject.setPrototypeOf(n, Ob§ject.assign(Ob§ject.create(Ob§ject.getPrototypeOf(n)), { pos: -5 })); }, text(n) { n.pos = "1"; }, missing(n) { n.end = undefined; }, half(n) { n.kind = 0.5; }, extra(n) { n.extra = 1; n[0] = 2; },
})`.split("§").join(globalThis.nothing ?? ""));
for (const [name, fate] of Object.entries(fates)) {
  for (const node of make(2)) {
    const line = [name, node.constructor.name, show(() => total([node, node]))];
    show(() => fate(node));
    line.push(show(() => total([node, node])), show(() => node.describe()), show(() => link([node], node)), show(() => total([node])), Object.getOwnPropertyNames(node).join(), show(() => node.width && node.width()));
    out.push(line.join(" "));
  }
}
// Subclasses that the program at run time makes.
const strangers = (0, eval)(`(Node, Token) => [class extends Token { constructor() { super(1, 2, 3); del§ete this.pos; this.more = 4; } }, class extends Node { }, class extends Token { pos = "own"; }, class extends Node { get end() { return 40; } set end(v) { } }]`.split("§").join(globalThis.nothing ?? ""))(Node, Token);
for (const Stranger of strangers) { const node = new Stranger(6, 1, 4); out.push(show(() => total([node, node])) + show(() => node.describe()) + Object.keys(node).join()); }
for (const made of [() => Reflect.construct(Node, [1, 2, 3], Identifier), () => Reflect.construct(Identifier, [1, 2, "r"], Node), () => Reflect.construct(Token, [1, 2, 3], Alias), () => Object.create(Identifier.prototype)]) { const node = made(); out.push(show(() => total([node])) + show(() => node.describe()) + Object.keys(node).join()); }
// Which of several parents a class has is known at run time.
class Left { constructor(a) { this.a = a; this.x = 1; } sum() { let t = 0; for (let i = 0; i < 3; i++) t += (this.a | 0) + this.x; return t; } }
class Right { constructor(a) { this.b = a; this.x = 2; } sum() { let t = 0; for (let i = 0; i < 3; i++) t += (this.b | 0) + this.x; return t; } }
for (const i of [0, 1]) {
  class Chosen extends [Left, Right][i] { constructor(a) { super(a); this.d = a; } all() { return [this.a, this.b, this.x, this.d, this.sum()].join(); } }
  class Below extends Chosen { constructor(a) { super(a); this.e = 1; } more() { return this.all() + this.e; } }
  for (let k = 0; k < 3; k++) { const d = new Chosen(k), e = new Below(k); out.push(d.all(), e.more(), Object.keys(d).join(), Object.keys(e).join()); delete d.x; out.push(d.all()); }
}
for (const line of out) console.log(line);
