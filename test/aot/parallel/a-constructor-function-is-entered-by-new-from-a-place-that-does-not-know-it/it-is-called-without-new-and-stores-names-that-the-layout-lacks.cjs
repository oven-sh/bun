const holder = { made: null }; globalThis.heldForWitness = holder;
function hidden(v) { holder.made = v; return Reflect.get(globalThis, "heldForWitness").made; }
function tried(f) { try { return f(); } catch (error) { return error.constructor.name + ":" + error.message.slice(0, 40); } }
function show(o) { return o === null || typeof o !== "object" ? typeof o + ":" + String(o) : Object.getPrototypeOf(o) === null ? "null-proto " + JSON.stringify(o) : (Object.getPrototypeOf(o).constructor && Object.getPrototypeOf(o).constructor.name) + " " + JSON.stringify(o) + " " + Reflect.ownKeys(o).map(String).join(); }
function Sloppy(a) { this.sloppyA = a; this.sloppyB = a + 1; }
const S = hidden(Sloppy);
console.log(show(new S(1)), tried(() => String(S(2))), globalThis.sloppyA, globalThis.sloppyB); delete globalThis.sloppyA; delete globalThis.sloppyB;
const target = { own: 1 }; S.call(target, 4); console.log(show(target)); const list = [1]; S.apply(list, [5]); console.log(list.sloppyA, list.sloppyB, list.length);
console.log(tried(() => S.call(5, 6)), tried(() => String(S.call(Object.freeze({}), 7))));
function Base(a) { this.base = a; } function Heir(a, b) { Base.call(this, a); this.heir = b; } Heir.prototype = Object.create(Base.prototype); Heir.prototype.constructor = Heir;
const E = hidden(Heir); for (let i = 0; i < 3; i++) console.log(show(new E(i, i + 1)), new E(i, 1) instanceof Base);
function Names(k, v, many) { this.fixed = 1; this[k] = v; if (many) { this.sometimes = many; this[0] = "index"; this[Symbol.for("s")] = "symbol"; } for (const n of ["p", "q"]) this[n] = n; this.fixed = 2; }
const N = hidden(Names); console.log(show(new N("late", 1, 0)), show(new N("fixed", 7, 1)), show(new N("__proto__", { above: 1 }, 0)), new N("__proto__", { above: 1 }, 0).above, show(new N("constructor", 3, 0)));
function Defaults(a = 1, { b } = { b: 2 }) { this.a = a; this.b = b; } const F = hidden(Defaults); console.log(show(new F()), show(new F(5, { b: 6 })), show(new F(undefined, undefined)));
function Few(a, b, c) { this.a = a; this.b = b; this.c = c; } const W = hidden(Few); console.log(show(new W()), show(new W(1)), show(new W(1, 2, 3, 4, 5)), show(new W(...[7, 8])));
function Closes(a) { this.get = () => a + this.n; this.n = 1; } const G = hidden(Closes); console.log(new G(4).get());
