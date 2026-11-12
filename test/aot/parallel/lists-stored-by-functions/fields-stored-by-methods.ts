// Loops that call small methods which store into a list field of their holder: swaps, sums in place, grids, a blur from one holder into another; the field is replaced, cut, shared, dropped or laid anew between.
function shown(x: any): string { return Array.isArray(x) || x instanceof Float64Array ? `[${x.length}:${Array.from({ length: x.length }, (_, i) => (i in x ? shown(x[i]) : "hole")).join(",")}]` : typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? "object" : `${typeof x}:${String(x)}`; }
const late = process.argv.length > 99 ? 1 : 0;
function veil(x: any): any { const all: any[][] = [[x], [0]]; return all[late]![0]; }

class Grid {
  cells: number[];
  constructor(cells: any, public width: number) { this.cells = cells; }
  at(i: number): number { return this.cells[i]!; }
  put(i: number, x: number): void { this.cells[i] = x; }
  add(i: number, x: number): void { this.cells[i]! += x; }
  swap(i: number, k: number): void { const kept = this.cells[i]!; this.cells[i] = this.cells[k]!; this.cells[k] = kept; }
  swapPattern(i: number, k: number): void { [this.cells[i], this.cells[k]] = [this.cells[k]!, this.cells[i]!]; }
  cell(x: number, y: number): number { return this.cells[y * this.width + x]!; }
  setCell(x: number, y: number, v: number): void { this.cells[y * this.width + x] = v; }
  replace(i: number, x: number): void { this.cells[i] = x; if (i === 2) this.cells = [9, 8, 7, 6, 5, 4]; this.cells[0] = x; }
  cut(i: number): void { this.cells[i] = 1; if (i === 2) this.cells.length = 1; }
  exchange(other: Grid, i: number, x: number): void { this.cells[i] = x; if (i === 1) { const kept = other.cells; other.cells = this.cells; this.cells = kept; } this.cells[i] = x + 1; }
  drop(i: number): void { this.cells[i] = 2; if (i === 1) delete (this as any).cells; }
  lay(i: number): void { this.cells[i] = 3; if (i === 1) Object.defineProperty(this, "cells", { get() { return [1, 2, 3]; }, configurable: true }); }

  reversed(): void { for (let i = 0, k = this.cells.length - 1; i < k; i++, k--) this.swap(i, k); }
  reversedByPattern(): void { for (let i = 0, k = this.cells.length - 1; i < k; i++, k--) this.swapPattern(i, k); }
  raised(): void { for (let i = 0; i < 6; i++) this.add(i, i % 3 === 2 ? 0.5 : 1); }
  filled(odd: any): void { for (let i = 0; i < 6; i++) this.put(i, i === 3 ? odd : i * 2); }
  turned(other: Grid): void { for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) other.setCell(y, x, this.cell(x, y)); }
  blurred(other: Grid): void { for (let y = 1; y < 2; y++) for (let x = 1; x < 2; x++) other.setCell(x, y, (this.cell(x - 1, y) + this.cell(x + 1, y) + this.cell(x, y - 1) + this.cell(x, y + 1)) / 4); }
  replaced(): void { for (let i = 0; i < 5; i++) this.replace(i, i * 0.5); }
  cutShort(): void { for (let i = 0; i < 5; i++) this.cut(i); }
  exchanged(other: Grid): void { for (let i = 0; i < 4; i++) this.exchange(other, i, i); }
  dropped(): void { for (let i = 0; i < 4; i++) this.drop(i); }
  laid(): void { for (let i = 0; i < 4; i++) this.lay(i); }
  both(other: Grid): void { for (let i = 0; i < 5; i++) { other.put(i, this.at(i)); this.put(i + 1, other.at(i)); } }
}

const lists = (): any[] => [[3, 1, 4, 1, 5, 9, 2, 6, 5], [2.5, -0, 0.5, 7, 1e300, -3, 4, 8, 0.25], [1, , 3, 4], ["a", 1, {}, 2], [], [7], Array.from({ length: 24 }, (_, k) => (k * 7) % 11), Array.from({ length: 24 }, (_, k) => k / 4 - 3), [undefined, 1, null, 2], Object.freeze([4, 5, 6]), new Float64Array([1.5, 2, 3]), undefined, null];
const work: ((first: Grid, second: Grid) => void)[] = [g => g.reversed(), g => g.reversedByPattern(), g => g.raised(), (g, o) => g.turned(o), (g, o) => g.blurred(o), g => g.replaced(), g => g.cutShort(), (g, o) => g.exchanged(o), g => g.dropped(), g => g.laid(), (g, o) => g.both(o), g => g.filled(1.5), g => g.filled("t"), g => g.filled(undefined), g => g.filled(2n), g => g.filled({ valueOf() { return 4; } })];
for (let l = 0; l < lists().length; l++) {
  for (let w = 0; w < work.length; w++) {
    for (const shares of [0, 1, 2]) {
      const list = veil(lists()[l]);
      const first = new Grid(list, 3), second = shares === 2 ? first : new Grid(shares ? list : veil([0, 0.5, 2, 3, 4, 5, 6, 7, 8]), 3);
      let answer = "";
      try { work[w]!(first, second); } catch (error) { answer = `threw ${(error as Error).constructor.name}`; }
      console.log(l, w, shares, answer, shown(list), shown(first.cells), shown(second.cells));
    }
  }
}
