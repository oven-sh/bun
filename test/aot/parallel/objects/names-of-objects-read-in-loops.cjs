// Loops read several names off each object of a list that nobody knows. The objects are of classes of the file: some lose a field, define it anew as an accessor, gain names, are frozen, inherit, or hold numbers, strings and nothing in their fields. Names that no object has are truthy of none.
"use strict";
const out = [];
class Point { constructor(line, column) { this.line = line; this.column = column; } }
class Span extends Point { constructor(line, column) { super(line, column); this.end = null; } get width() { return this.end === null ? 0 : this.end - this.column; } }
function Old(line, column) { this.column = column; this.line = line; }
Old.prototype.end = 4;
const unknown = (list) => JSON.parse("[0]").concat(list).slice(1);
function both(list) { let s = 0; for (let i = 0; i < list.length; i++) { const p = list[i]; s += p.line + p.column; } return s; }
function three(list) { let s = 0; for (let i = 0; i < list.length; i++) { const p = list[i]; s += p.line * 2 + p.column - (p.end | 0); } return s; }
function mixed(list) { let t = ""; for (const p of list) t += p.line + ":" + p.column + (p.end ? "e" : "") + (p.nowhere ? "n" : ""); return t; }
function absent(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].extra | 0; return s; }
function truths(list) { let s = 0; for (let i = 0; i < list.length; i++) { if (list[i].extra) s++; if (list[i].nowhere) s += 100; } return s; }
function elements(list) { let s = 0; for (let i = 0; i < list.length; i++) if (list[i]) s++; return s; }
function defaults(list) { let s = 0; for (let i = 0; i < list.length; i++) { const { line = 7, end = 5 } = list[i]; s += line + end; } return s; }
function called(list, f) { let s = 0; for (let i = 0; i < list.length; i++) { const p = list[i]; s += p.line; f(p, i); s += p.column + p.line; } return s; }
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
globalThis.kept = [Point, Span, Old, both, three, mixed, absent, truths, elements, defaults, called];
const changes = [
  () => {}, (p, i) => { if (i % 3 === 0) delete p.column; }, (p, i) => { if (i % 4 === 0) Object.defineProperty(p, "line", { get() { return 1000; }, set() {}, configurable: true }); }, (p, i) => { p["late" + i % 3] = i; },
  (p) => Object.freeze(p), (p, i) => { if (i % 5 === 0) Object.setPrototypeOf(p, { end: 3, nowhere: 1 }); }, (p, i) => { p.line = i % 2 ? i : i + 0.5; }, (p, i) => { p.column = i % 3 === 1 ? "c" : undefined; }, (p, i) => { if (i % 6 === 0) p.extra = i - 6; },
  (p, i) => { delete p.line; if (i % 2) p.line = 3; }, (p, i) => { p.end = [0, "", "x", NaN, {}, false, -0, 5n, Symbol.iterator, null][i % 10]; },
];
const make = [(i) => new Point(i, 1), (i) => new Span(i, 2), (i) => new Old(i, 3), (i) => ({ line: i, column: 4 }), (i) => ({ column: 5, line: i, end: 6 }), (i) => Object.create(new Point(i, 6))];
for (let kind = 0; kind < 8; kind++) {
  for (let change = 0; change < changes.length; change++) {
    const list = unknown(Array.from({ length: 60 }, (_, i) => make[kind < 6 ? kind : kind === 6 ? i % 2 : i % 6](i)));
    const before = [both, three, absent, truths, elements, defaults].map((f) => show(() => { let s = 0; for (let k = 0; k < 4; k++) s = f(list); return s; }));
    list.forEach((p, i) => { try { changes[change](p, i); } catch {} });
    const after = [both, three, mixed, absent, truths, elements, defaults].map((f) => show(() => { let s = 0; for (let k = 0; k < 4; k++) s = f(list); return s; }).slice(0, 60));
    const fresh = unknown(Array.from({ length: 40 }, (_, i) => make[kind < 6 ? kind : i % 6](i)));
    out.push([kind, change, ...before, ...after, show(() => called(fresh, changes[change])), show(() => called(fresh, (p, i) => { if (i === 20) fresh[21] = null; }))].join(" "));
  }
}
out.push(show(() => elements(unknown([0, 1, "", "a", null, undefined, true, false, NaN, 0.5, -0, {}, [], 0n, 5n, Symbol.iterator]))));
out.push(show(() => truths(unknown([1, "a", true, [], Object.assign([], { extra: 1 }), Object.assign(() => 1, { extra: "" })]))));
out.push(show(() => both(unknown([new Point(1, 2), null]))), show(() => truths(unknown([undefined]))), show(() => absent(unknown([Object.assign(new Map(), { extra: 2.5 }), "text", 5]))));
let hash = 0;
for (const line of out) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
for (let i = 0; i < out.length; i += 9) console.log(out[i].slice(0, 150));
for (const line of out.slice(-5)) console.log(line);
console.log(out.length, hash);
