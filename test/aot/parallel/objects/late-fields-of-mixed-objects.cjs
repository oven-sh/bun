// Fields stored outside of constructors, read through values that may be objects of many classes: each read finds what its own class was given.
const fs = require("node:fs");
globalThis.load = async function (name) { return await import(name); };
function Cell(x) { this.x = x; }
Cell.prototype.isEmpty = function () { return this.x === 0; };
function Node(x) { this.x = x; }
Node.prototype.cost = function (from) { return from && from.x != this.x ? this.x * 1.5 : this.x; };
class Box { constructor(y) { this.y = y; } }
class Text { constructor(s) { this.s = s; } }
class Pair { constructor(a, b) { this.a = a; this.b = b; } }
class Late { }
function clean(node) { node.f = 0; node.seen = false; node.parent = null; }
function path(node) { const out = []; let at = node; while (at.parent) { out.unshift(at.x); at = at.parent; } return out; }
const lines = [];
const nodes = [];
for (let i = 0; i < 40; i++) { const n = new Node(i); clean(n); nodes.push(n); }
for (let i = 1; i < 40; i++) { const n = nodes[i]; n.parent = nodes[(i * 7) % i]; n.f = n.cost(n.parent) + n.parent.f; n.seen = (i & 1) === 0; }
let total = 0;
for (let turn = 0; turn < 50; turn++) for (const n of nodes) if (n.seen) total += n.f;
lines.push(total, path(nodes[39]).join(), path(nodes[22]).join());

// The classes below meet in one list.
const mixed = [];
function keep(value) { mixed.push(value); return value; }
function nameOf(value, i) { return i % 3 ? "name" + i : i; }
for (let i = 0; i < 60; i++) {
  switch (i % 6) {
    case 0: { const c = new Cell(i); c.late = i; keep(c); break; }
    case 1: { const b = new Box(i); b.late = "box" + i; keep(b); break; }
    case 2: { const t = new Text("t" + i); t.late = i * 0.25; keep(t); break; }
    case 3: { const p = new Pair(i, -i); p.late = { x: i }; keep(p); break; }
    case 4: { const l = new Late(); l.late = function () { return this.other + i; }; l.other = i; keep(l); break; }
    case 5: { const o = { z: i }; o.late = nameOf(o, i); keep(o); break; }
  }
}
function read(list) {
  let sum = 0, text = "";
  for (let i = 0; i < list.length; i++) {
    const late = list[i].late;
    if (typeof late === "number") sum += late;
    else if (typeof late === "function") sum += list[i].late();
    else if (typeof late === "string") text += late;
    else if (late) sum -= late.x;
    else text += "?";
  }
  return sum + " " + text;
}
lines.push(read(mixed));
for (let i = 0; i < mixed.length; i++) if (i % 4 === 1) mixed[i].late = i % 8 === 1 ? "again" + i : i / 2;
lines.push(read(mixed));
const key = process.argv.length > 99 ? "other" : "late";
for (let i = 0; i < mixed.length; i += 5) mixed[i][key] = null;
lines.push(read(mixed), mixed.map(o => Object.keys(o).join("+")).slice(0, 12).join());
// A typed store behind the meeting is seen through the mixed values, and the other way round.
const cell = mixed[6] instanceof Cell ? mixed[6] : new Cell(1);
cell.late = "typed"; lines.push(String(mixed[6].late), String(cell.late));
mixed[6].late = 12.5; lines.push(cell.late + 1);
for (const o of mixed) if (o instanceof Text) o.parent = cell;
lines.push(mixed.filter(o => o.parent).length, path(mixed[2]).join(), mixed[2].parent.x, mixed[8].parent.late);
delete cell.late; lines.push("late" in cell, mixed[6].late);
for (const line of lines) console.log(line);
