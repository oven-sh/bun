// Methods copied into loops that read and store into arrays out of fields in some iterations; the arrays hold numbers, texts, nothing.
class Grid { cells: number[]; other: number[]; constructor(public w: number, public h: number, cells: number[], other: number[]) { this.cells = cells; this.other = other; }
  get(x: number, y: number): number { if (x < 0 || x >= this.w || y < 0 || y >= this.h) return 0; return this.cells[y * this.w + x]!; }
  pick(x: number): number { return x > 2 ? this.cells[x]! : this.other[x]!; }
  put(x: number, v: number): void { if (x > 1) this.cells[x] = v; }
  swap(): void { const kept = this.cells; this.cells = this.other; this.other = kept; } }
function sum(g: Grid): number { let s = 0; for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) s += g.get(x - 1, y) + g.get(x + 1, y); return s; }
function picks(g: Grid): number { let s = 0; for (let x = 0; x < 6; x++) s += g.pick(x); return s; }
function puts(g: Grid): number { let s = 0; for (let x = 0; x < 6; x++) { g.put(x, x + 0.5); s += g.pick(x) + g.get(x, 0); } return s; }
function swaps(g: Grid): number { let s = 0; for (let x = 0; x < 6; x++) { s += g.pick(x); if (x === 3) g.swap(); } return s; }
function two(a: Grid, b: Grid): number { let s = 0; for (let x = 0; x < 6; x++) s += a.pick(x) * b.pick(5 - x); return s; }
const texts = ["[1,2,3,4,5,6,7,8,9]", "[1.5,2.5,3.5,4.5,5.5,6.5,7,8,9]", "[1,2]", "[]", "[1,\"x\",3,null,5,6,7,8,9]", "null", "{\"length\":3,\"0\":4}", "\"text\""];
for (const a of texts) for (const b of texts) {
  const out: string[] = [];
  for (const run of [sum, picks, puts, swaps]) { const g = new Grid(3, 3, JSON.parse(a), JSON.parse(b)); let r: string; try { r = String(run(g)); } catch (e: any) { r = e.constructor.name; } out.push(r, JSON.stringify(g.cells) + JSON.stringify(g.other)); }
  let r: string; try { r = String(two(new Grid(3, 3, JSON.parse(a), JSON.parse(b)), new Grid(2, 2, JSON.parse(b), JSON.parse(a)))); } catch (e: any) { r = e.constructor.name; } out.push(r);
  console.log(a, b, out.join(" "));
}
export {};
