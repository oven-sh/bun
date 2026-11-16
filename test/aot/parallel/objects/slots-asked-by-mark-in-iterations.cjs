// Methods that loops reach by other methods read several fields of objects that are not filled yet, have lost a field or were never constructed.
"use strict";
const out = [];
function Scanner(text, early) {
  this.text = text;
  this.pos = 0;
  if (early) this.early = this.copy(1);
  this.start = 0; this.end = 0; this.kind = "none"; this.lastStart = -1; this.lastEnd = -1; this.lastKind = "";
  this.log = [];
}
const methods = Scanner.prototype;
methods.copy = function (by) { this.lastStart = this.start; this.lastEnd = this.end; this.lastKind = this.kind; this.start = this.pos; this.end = this.pos + by; this.pos += by; return this.lastStart + ":" + this.lastEnd + this.lastKind + this.start + "-" + this.end; };
methods.step = function (by) { const was = this.copy(by); this.kind = this.text[this.pos] || "end"; return was + this.kind; };
methods.run = function (turns) { let found = ""; for (let i = 0; i < turns; i++) found += this.step(1) + ";"; return found + Object.keys(this).join(); };
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name + (error.message.includes("read") ? "" : ""); } };
const strange = [
  () => new Scanner("abcdef"), () => new Scanner("abcdef", true), () => Object.create(methods), () => Object.setPrototypeOf({ pos: 2, text: "xyz" }, methods),
  () => { const s = new Scanner("abc"); delete s.end; return s; }, () => { const s = new Scanner("abc"); delete s.start; delete s.kind; s.start = 5; return s; },
  () => { const s = new Scanner("abc", true); delete s.lastKind; delete s.pos; return s; }, () => Object.freeze(new Scanner("abc")), () => Object.seal(new Scanner("abc", true)),
  () => Object.defineProperty(new Scanner("abc"), "end", { get() { return "got"; }, set(v) { out.push("set " + v); }, enumerable: true }), () => Object.create(new Scanner("below")), () => new Proxy(new Scanner("abc"), {}),
  () => new (class Heir extends Scanner { constructor() { super("heir", true); this.more = 1; } copy(by) { return "h" + super.copy(by) + this.more; } })(), () => { const s = new Scanner("abc"); Object.defineProperty(s, "start", { value: 3, writable: false }); return s; },
];
for (const create of strange) for (let round = 0; round < 3; round++) out.push(show(() => { const s = create(); return s.early + s.run(3) + s.run(2); }));
const kept = new Scanner("kept"); for (let i = 0; i < 4; i++) { out.push(show(() => kept.run(1))); if (i === 1) delete kept.lastEnd; if (i === 2) kept.lastEnd = "back"; }
for (const line of out) console.log(line);
