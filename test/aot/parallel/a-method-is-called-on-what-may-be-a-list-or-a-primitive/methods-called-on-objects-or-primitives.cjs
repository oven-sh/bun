"use strict";
const out = [], t = f => { try { const v = f(); out.push(typeof v + ":" + String(v)); } catch (e) { out.push(e.name); } };
class Row { constructor(a) { this.a = a; this.b = [a]; } total() { return this.a + this.b.length; } }
const key = JSON.parse('"go"'), pick = (x, i) => [x, "text", 5, true, null, undefined, 7n][i];
function methods(x) { t(() => x.sort((p, q) => q.total() - p.total()).length); t(() => x.slice(0, 2).map(r => r.total()).join()); t(() => x.at(0).total()); t(() => x.total()); t(() => x.concat(x).length); t(() => x.toString().length); t(() => x.own(x)); }
const rows = () => [new Row(1), new Row(3), new Row(2)], kept = rows();
Object.defineProperty(String.prototype, "own", { value: function (x) { out.push(typeof this + (this === x)); return x; }, configurable: true, writable: true });
Number.prototype.total = function () { return this * 2; };
const groups = new Map(); for (const city of ["a", 5, JSON.parse('"b"'), { c: 1 }]) groups.set(city, rows());
function report() { let s = ""; for (const [city, list] of groups) { list.sort((p, q) => q.total() - p.total()); for (const r of list.slice(0, 2)) s += r.total() + "/" + r.b[0]; s += typeof city; } return s; }
for (let r = 0; r < 40; r++) { out.length = Math.min(out.length, 500); for (let i = 0; i < 7; i++) { methods(pick(rows(), i)); methods(pick(new Row(i), i)); } t(report); t(() => kept.map(r => r.total()).join()); if (r === 20) kept[0].total = () => "own"; if (r === 25) Row.prototype.total = function () { return -this.a; }; }
console.log(out.join("|"));
