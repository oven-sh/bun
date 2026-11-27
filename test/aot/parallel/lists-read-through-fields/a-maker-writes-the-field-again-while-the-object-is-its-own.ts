// While an object is known to its maker alone, every store of the maker is part of the construction, however often it writes one field. Loops of the maker read what the turn before has stored: in a constructor, in a function that makes a record, in a constructor function.
const out: unknown[] = [];
class Alone { readonly items: number[]; readonly seen: number; constructor(n: number) { this.items = [0.5]; let s = 0; for (let t = 0; t < n; t++) { for (let i = 0; i < this.items.length; i++) s += this.items[i]!; this.items = t & 1 ? [t + 1.5] : [t + 1.5, 2.5, 3.5]; } this.seen = s; } }
function record(n: number): number { const o = { items: [0.5], width: 1 }; let s = 0; for (let t = 0; t < n; t++) { for (let i = 0; i < o.items.length; i++) s += o.items[i]! * o.width; o.items = t & 1 ? [t + 1.5] : [t + 1.5, 2.5, 3.5]; o.width = t + 2; } return s; }
class Wide { readonly width: number; readonly seen: number; constructor(n: number) { this.width = 1; let s = 0; for (let t = 0; t < n; t++) { s += this.width * 10; this.width = t + 2; } this.seen = s; } }
class Once { readonly items?: number[]; readonly seen: number; constructor(n: number) { let s = 0; for (let t = 0; t < n; t++) { if (t === 1) this.items = [1.5, 2.5, 3.5]; s += this.items ? this.items.length + this.items[t - 1]! : 100; } this.seen = s; } }
function once(n: number): number { const o: { items?: number[] } = {}; let s = 0; for (let t = 0; t < n; t++) { if (t === 1) o.items = [1.5, 2.5, 3.5]; s += o.items ? o.items.length + o.items[t - 1]! : 100; } return s; }
for (const n of [0, 1, 4]) out.push(new Once(n).seen, once(n));
for (const n of [0, 1, 4]) { const a = new Alone(n), w = new Wide(n); out.push(a.seen, a.items.join(), record(n), w.seen, w.width); }
console.log(out.join("|"));
