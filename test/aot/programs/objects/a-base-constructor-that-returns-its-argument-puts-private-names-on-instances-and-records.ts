// A class below a constructor that returns its argument puts its private names on instances of another class, on records and on frozen records.
class Identity { constructor(o: object) { return o; } }
class Stamp extends Identity { #mark = 5; #other = "m"; static read(o: object): string { return #mark in o ? (o as Stamp).#mark + (o as Stamp).#other : "none"; } static bump(o: object) { (o as Stamp).#mark++; } }
class Point { x: number; y: number; #own = 1; constructor(x: number, y: number) { this.x = x; this.y = y; } sum(): number { return this.x + this.y + this.#own; } }
type Pair = { x: number; y: number };
function pair(i: number): Pair { return { x: i, y: i + 1 }; }
const out: string[] = [];
for (let i = 0; i < 4; i++) {
  const p = new Point(i, 1), q = pair(i), f = Object.freeze(pair(i));
  for (const o of [p, q, f]) {
    let r = "ok"; try { if (i >= 1) new Stamp(o); if (i >= 2) Stamp.bump(o); if (i >= 3) new Stamp(o); } catch (e) { r = (e as Error).name; }
    out.push([r, Stamp.read(o), o.x + o.y, Object.keys(o).join(), JSON.stringify(o), Reflect.ownKeys(o).length].join(" "));
  }
  out.push(String(p.sum()));
}
console.log(out.join("\n"));
