// Loops take the bits of values of every kind: fields that classes hold, names that objects lack, inherit or compute, elements with holes, and values from in front of the loop.
"use strict";
const name = "Bits" + process.argv.length;
const unknown = list => JSON.parse("[0]").concat(list).slice(1);
class Flags { constructor(line, flag) { this.line = line; this.flag = flag; this.late = flag; } step() { return (this.flag & 3) + (this.late >>> 1); } }
class Wide extends Flags { constructor(line, flag) { super(line, flag); this.wide = flag; } }
globalThis[name] = Flags; globalThis[name + "W"] = Wide;
const F = globalThis[name], W = globalThis[name + "W"];
function or(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].flag | 0; return s; }
function and(list) { let s = 0; for (let i = 0; i < list.length; i++) { const p = list[i]; s += p.flag & 7; } return s; }
function xor(list) { let s = 0; for (let i = 0; i < list.length; i++) s ^= list[i].flag; return s; }
function not(list) { let s = 0; for (let i = 0; i < list.length; i++) s += ~list[i].flag; return s; }
function left(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].flag << 2; return s; }
function right(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].flag >> 1; return s; }
function unsigned(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].flag >>> 1; return s; }
function tested(list) { let s = 0; for (let i = 0; i < list.length; i++) if (list[i].flag & 1) s++; return s; }
function absent(list) { let s = 0; for (let i = 0; i < list.length; i++) s += (list[i].nowhere | 1) + (list[i].flag & 1); return s; }
function both(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].flag | list[i].late; return s; }
function twice(list) { let s = 0; for (let i = 0; i < list.length; i++) { const p = list[i]; s += (p.flag & 1) + (p.flag >> 1); if (p.flag === true) s += 100; } return s; }
function elements(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i] | 0; return s; }
function shifts(list) { let s = 0; for (let i = 0; i < list.length; i++) s = (s << 1 ^ list[i] >>> 3 ^ ~list[i]) | 0; return s; }
function outside(list, value) { let s = 0; for (let i = 0; i < list.length; i++) s += (value | i) + (i & value) + (value << 1); return s; }
function keyed(list, table) { let s = 0; for (let i = 0; i < list.length; i++) s += table[list[i].flag & 3]; return s; }
function steps(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].step(); return s; }
const forms = [or, and, xor, not, left, right, unsigned, tested, absent, both, twice];
globalThis[name + "k"] = [...forms, elements, shifts, outside, keyed, steps];
let order = "";
const counted = { valueOf() { order += "v"; return 5; } }, text = { toString() { order += "t"; return "6"; } }, throwing = { valueOf() { throw new RangeError("bits"); } };
const kinds = [0, 1, -1, 7, 2147483647, -2147483648, 0.5, -0.5, -0, NaN, Infinity, -Infinity, 1e10, -1e10, 4294967295, 4294967296.5, 1e300, undefined, null, true, false, "", "3", "x", "0x10", [], [4], {}, counted, text, new Number(9), new Date(12), Symbol.iterator, 3n, throwing, () => 1];
const show = run => { try { return String(run()); } catch (error) { return error.constructor.name + ":" + error.message.slice(0, 24); } };
const out = [];
for (let round = 0; round < 3; round++) {
  for (let k = 0; k < kinds.length; k++) {
    const value = kinds[k], other = kinds[(k + round + 1) % kinds.length];
    for (const make of [v => new F(1, v), v => ({ flag: v, late: v }), v => Object.create({ flag: v, late: 1 }), v => ({ get flag() { return v; }, late: v }), v => new W(2, v), v => JSON.parse('{"late":2}')]) {
      const same = unknown(Array.from({ length: 9 }, () => make(value))), changing = unknown(Array.from({ length: 9 }, (_, i) => make(i < 5 ? value : other))), mixed = unknown([new F(0, 3), make(value), { flag: 1 }, make(other)]);
      for (const form of forms) out.push(show(() => form(same)), show(() => form(changing)), show(() => form(mixed)));
      out.push(show(() => keyed(same, ["a", "b", "c", "d"])), show(() => steps(unknown([new F(0, 1), new F(1, value), new W(1, other)]))));
    }
    const list = unknown(Array.from({ length: 9 }, (_, i) => i < 6 ? value : other)), holes = unknown([1, 2, value]); holes.length = 8; holes[6] = other;
    out.push(show(() => elements(list)), show(() => shifts(list)), show(() => elements(holes)), show(() => shifts(holes)), show(() => outside(list, value)), show(() => elements(unknown([0.5, 1.5, value]))));
  }
}
let hash = 0;
for (const line of out) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
console.log(out.length, hash, order.length);
for (let i = 0; i < out.length; i += 211) console.log(out[i]);
