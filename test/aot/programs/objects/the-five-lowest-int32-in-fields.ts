// A four-byte slot for an integer keeps a few of the lowest int32 for its own markers. Those numbers are ordinary values: 1 << 31 is a flag like any other.
declare const console: { log(...values: unknown[]): void };
const lines: string[] = [];
function say(label: string, value: unknown) { lines.push(label + ": " + JSON.stringify(value)); }
const lowest = [-2147483648, -2147483647, -2147483646, -2147483645, -2147483644, -2147483643, -2147483642];

const enum Flags { None = 0, A = 1 << 0, B = 1 << 1, C = 1 << 2, Top = 1 << 31 }
class Point { constructor(public flags: number, public id: number) {} }
class Late { flags = 0; id = 0; other?: number; }
interface Rec { flags: number; id: number }
const Made = function (this: Rec, flags: number, id: number) { this.flags = flags; this.id = id; } as unknown as new (flags: number, id: number) => Rec;
function flagsOf(r: Rec): number { return r.flags; }
function hasTop(r: Rec): boolean { return (r.flags & Flags.Top) !== 0; }
function add(r: Rec, f: number) { r.flags |= f; }
function sum(list: Rec[]): number { let t = 0; for (const r of list) t += flagsOf(r) % 1000 + r.id; return t; }

const points: Rec[] = [], lates: Rec[] = [], mades: Rec[] = [], literals: Rec[] = [];
for (let round = 0; round < 300; round++) for (let i = 0; i < lowest.length; i++) {
  points.push(new Point(lowest[i], i)); const late = new Late(); late.flags = lowest[i]; late.id = i; late.other = lowest[i]; lates.push(late);
  mades.push(new Made(lowest[i], i)); literals.push({ flags: lowest[i], id: i });
}
say("sums", [sum(points), sum(lates), sum(mades), sum(literals)]);
say("points", points.slice(0, 7).map(flagsOf)); say("lates", lates.slice(0, 7).map(r => [flagsOf(r), (r as Late).other])); say("mades", mades.slice(0, 7).map(flagsOf)); say("literals", literals.slice(0, 7).map(flagsOf));
say("keys", [Object.keys(points[0]).join(), Object.keys(lates[1]).join(), Object.keys(mades[2]).join(), Object.keys(literals[3]).join()]);
say("top", [points, lates, mades, literals].map(list => list.slice(0, 7).map(hasTop)));
for (const list of [points, lates, mades, literals]) { const r = list[6]; r.flags = 0; add(r, Flags.Top); const first = flagsOf(r); add(r, Flags.A); const second = flagsOf(r); add(r, Flags.B | Flags.C); say("set by bits", [first, second, flagsOf(r), JSON.stringify(r)]); }
{ const p = new Point(Flags.Top | Flags.A, Flags.Top); say("both fields", [p.flags, p.id, p.flags === -2147483647, p.id === -2147483648, { ...p }]); }
{ const copies = points.slice(0, 5).map(p => ({ ...p })); say("spread", copies); say("assign", Object.assign(new Late(), lates[0])); }
say("sums again", [sum(points), sum(lates), sum(mades), sum(literals)]);
console.log(lines.join("\n"));
