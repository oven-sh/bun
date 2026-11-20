// Loops of methods that a mixin lays onto other objects go over lists of rows, over views of them and over receivers of other kinds. Receivers, rows, bounds, fields and methods change between the loops and within them.
"use strict";
const show = v => (v === undefined ? "_" : Object.is(v, -0) ? "-0" : typeof v === "number" ? String(Math.round(v * 1000) / 1000) : String(v));
const said = rows => Array.from(rows, row => Array.from(row, show).join(" ")).join("|");
const measures = {
  filled(value) { for (let i = 0; i < this.rows.length; i++) { const row = this.rows[i]; for (let j = 0; j < this.width; j++) row[j] = value + i * j; } return this; },
  scaled(by) { for (let i = 0; i < this.rows.length; i++) { const row = this.rows[i]; for (let j = 0; j < this.width; j++) row[j] = row[j] * by + this.lift; } return this; },
  summed() { let sum = 0; for (let i = 0; i < this.rows.length; i++) for (let j = 0; j < this.width; j++) sum += this.rows[i][j] * this.weigh(j); return sum; },
  weigh(j) { return j + 1; },
  shifted() { for (let i = 0; i < this.rows.length; i++) { const row = this.rows[i]; for (let j = this.width - 1; j > 0; j--) row[j] = row[j - 1]; row[0] = this.lift; } return this; },
};
const mixed = target => { for (const name of Object.keys(measures)) target[name] = measures[name]; return target; };
class Sheet { constructor(h, w) { this.rows = Array.from({ length: h }, () => new Array(w).fill(0)); this.width = w; this.lift = 0.5; } }
class Strip { constructor(h, w, Kind) { this.lift = 1; this.width = w; this.rows = Array.from({ length: h }, () => new Kind(w)); } }
class Window { constructor(h, w) { const all = new Float64Array(h * w); this.rows = Array.from({ length: h }, (_, i) => all.subarray(i * w, i * w + w)); this.width = w; this.lift = -1; this.all = all; } }
mixed(Sheet.prototype); mixed(Strip.prototype); mixed(Window.prototype);
const plain = (h, w) => mixed({ rows: Array.from({ length: h }, (_, i) => Array.from({ length: w }, (_, j) => i - j)), width: w, lift: 2 });
const receivers = [() => new Sheet(3, 4), () => new Strip(3, 4, Float32Array), () => new Strip(3, 4, Uint8Array), () => new Strip(2, 5, Int32Array), () => new Window(3, 4), () => plain(3, 4), () => new Strip(2, 3, Uint8ClampedArray)];
for (let turn = 0; turn < 40; turn++) { const each = receivers[turn % receivers.length](); each.filled(turn).scaled(1.5).shifted(); const sum = each.summed(); if (turn > 32) console.log(each.constructor.name, sum, said(each.rows)); }
// Bounds, rows and fields that change between the loops.
const changes = [["wider", s => { s.width++; }], ["narrower", s => { s.width -= 2; }], ["short row", s => { s.rows[1] = [1]; }], ["view among lists", s => { s.rows[0] = new Float32Array(s.width); }], ["lists among views", s => { s.rows[0] = Array.from(s.rows[0]); }], ["a text", s => { s.rows[0][1] = "3"; }], ["a hole", s => { delete s.rows[s.rows.length - 1][0]; }], ["no rows", s => { s.rows = []; }], ["object rows", s => { s.rows = [{ 0: 1, 1: 2 }, { 0: 3 }]; }], ["lift gone", s => { delete s.lift; }], ["lift a text", s => { s.lift = "!"; }], ["fraction", s => { s.width = 2.5; }], ["frozen", s => { for (const row of s.rows) if (Array.isArray(row)) Object.freeze(row); }]];
for (const make of receivers) for (const [what, change] of changes) { const each = make().filled(1); let end; try { change(each); end = said(each.scaled(2).shifted().rows) + " " + show(each.summed()); } catch (error) { end = error.constructor.name; } console.log(what, end); }
// What the loop itself changes: a method that swaps rows, a getter for the bound, a setter for the row.
const swaps = new Sheet(3, 3); let turns = 0; swaps.filled(2).weigh = function (j) { if (++turns === 4) this.rows[2] = Float64Array.of(9, 8, 7); if (turns === 7) this.width = 2; return j; }; console.log(swaps.summed(), turns, said(swaps.rows));
const counted = new Window(2, 3).filled(1); let asked = 0; Object.defineProperty(counted, "width", { get() { return asked++ < 5 ? 3 : 1; } }); console.log(said(counted.scaled(3).rows), asked);
const replaced = new Strip(2, 3, Int8Array).filled(100); replaced.scaled = function (by) { return measures.scaled.call(this, by * 2); }; console.log(said(replaced.scaled(1).rows)); Sheet.prototype.weigh = () => 10; console.log(new Sheet(2, 2).filled(1).summed(), new Strip(2, 2, Int16Array).filled(1).summed());
for (const bad of [null, undefined, 5, { rows: null, width: 1 }, { rows: [null], width: 1, lift: 0 }]) { try { console.log(measures.scaled.call(bad, 2) === bad); } catch (error) { console.log(error.constructor.name); } }
