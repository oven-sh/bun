// A constructor fills fields in each of two branches: reads and stores expect them, whatever becomes of the object.
// STATISTIC: FieldsExpectedFromAllocation >= 6
"use strict";
const out = [];
const show = (f) => { try { const r = f(); return r && typeof r === "object" ? JSON.stringify(r) : String(r); } catch (error) { return error.constructor.name; } };
function Scanner(input, start) {
  this.input = input;
  if (start) { this.pos = start; this.lineStart = input.lastIndexOf("\n", start - 1) + 1; this.line = input.slice(0, this.lineStart).split("\n").length; } else { this.pos = this.lineStart = 0; this.line = 1; }
  this.value = null;
  this.words = [];
}
Scanner.prototype.place = function place() { return { line: this.line, column: this.pos - this.lineStart }; };
Scanner.prototype.code = function code() { const c = this.input.charCodeAt(this.pos); return c === 44 ? this.input.charCodeAt(this.pos + 1) + 100 : c; };
Scanner.prototype.skip = function skip() { while (this.pos < this.input.length) { const c = this.input.charCodeAt(this.pos); if (c === 10) { ++this.pos; ++this.line; this.lineStart = this.pos; } else if (c === 32) ++this.pos; else break; } };
Scanner.prototype.next = function next() { this.skip(); const start = this.pos; while (this.pos < this.input.length && this.input.charCodeAt(this.pos) > 32) this.pos += 1; this.value = this.input.slice(start, this.pos); this.words.push(this.value + this.place().column + this.line); return this.value; };
Scanner.prototype.all = function all() { while (this.next()); return this.words.join(" ") + Object.keys(this) + this.code(); };
globalThis.outside = { Scanner, scanner: new Scanner("x", 0), change(scanner) { return scanner; } };
const text = "one two\n three,four\n\n five six  seven\neight";
for (const start of [0, 4, 9, 22]) out.push(globalThis.outside.change(new Scanner(text, start)).all());
// Nothing but the program at run time knows this text.
const fates = (0, eval)(`({
  nothing(s) {}, deleted(s) { del§ete s.pos; }, deletedLine(s) { del§ete s.line; }, again(s) { del§ete s.pos; s.pos = 3; }, frozen(s) { Ob§ject.freeze(s); }, sealed(s) { Ob§ject.seal(s); }, closed(s) { Ob§ject.preventExtensions(s); }, closedWithout(s) { del§ete s.lineStart; Ob§ject.preventExtensions(s); },
  locked(s) { Ob§ject.defineProperty(s, "pos", { writable: false }); }, hidden(s) { Ob§ject.defineProperty(s, "line", { enumerable: false }); }, accessor(s) { let held = 2; Ob§ject.defineProperty(s, "pos", { get() { return held; }, set(v) { held = v + 1; }, configurable: true, enumerable: true }); },
  above(s) { del§ete s.pos; let held = 1; Ob§ject.setPrototypeOf(s, Ob§ject.create(Ob§ject.getPrototypeOf(s), { pos: { get() { return held; }, set(v) { held = v; this.kept = v; }, configurable: true } })); }, inherited(s) { del§ete s.line; Ob§ject.setPrototypeOf(s, Ob§ject.assign(Ob§ject.create(Ob§ject.getPrototypeOf(s)), { line: 50 })); },
  text(s) { s.pos = "1"; }, missing(s) { s.lineStart = undefined; }, big(s) { s.line = 2 ** 31; }, half(s) { s.pos = 0.5; }, extra(s) { s.extra = 1; s[0] = 2; },
})`.split("§").join(globalThis.nothing ?? ""));
for (const [name, fate] of Object.entries(fates)) {
  for (const start of [0, 9]) {
    const scanner = globalThis.outside.change(new Scanner("ab cd,e\nfg h", start));
    out.push([name, start, show(() => scanner.next()), show(() => scanner.place()), show(() => scanner.code())].join(" "));
    fate(scanner);
    let turns = 0;
    const push = scanner.words.push;
    scanner.words.push = function (word) { if (++turns > 4) throw new RangeError("enough"); return push.call(this, word); };
    out.push([show(() => scanner.next()), show(() => scanner.place()), show(() => scanner.code()), show(() => scanner.skip()), show(() => scanner.all()), Object.getOwnPropertyNames(scanner).join(), show(() => JSON.stringify([scanner.pos, scanner.line, scanner.lineStart, scanner.kept]))].join(" "));
  }
}
// The same without a branch that fills them, and a constructor that returns or throws between.
class Some { constructor(kind) { if (kind === 1) { this.a = 1; this.b = 2; } else if (kind === 2) { this.b = 3; this.a = 4; } else if (kind === 3) throw new TypeError("three"); else if (kind === 4) return { a: 9, b: 8, sum: Some.prototype.sum, set: Some.prototype.set }; this.c = kind; } sum() { let s = 0; for (let i = 0; i < 3; i++) s += (this.a | 0) + (this.b | 0) + this.c; return s; } set(v) { this.a = v; this.b = v; this.a += 1; return Object.keys(this) + this.sum(); } }
for (let round = 0; round < 2; round++) for (let kind = 0; kind < 6; kind++) out.push("some " + kind + show(() => { const s = new Some(kind); return s.sum() + s.set(kind) + s.sum(); }));
class Both { constructor(kind) { if (kind) { this.a = 1; this.b = 2; } else { this.b = 3; this.a = 4; } } sum() { return this.a * 10 + this.b; } set(v) { this.a = v; this.b += v; return Object.keys(this) + this.sum(); } }
class Third extends Both { constructor(kind) { super(kind); if (kind) this.c = 1; else this.c = 2; } sum() { return super.sum() + this.c; } }
for (const make of [() => new Both(0), () => new Both(1), () => new Third(0), () => new Third(1), () => Reflect.construct(Both, [1], Third), () => Object.create(Third.prototype)]) { const o = make(); out.push(show(() => o.sum()) + show(() => o.set(5)) + show(() => o.sum())); }
for (const line of out) console.log(line);
