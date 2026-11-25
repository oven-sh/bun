// Under: --aot-testing=CheckBoundsAtRunTime: every read of an element is checked against its array
interface Undo { readonly from: number; readonly moved: number }
class Board { cells: number[]; undos: Undo[] = []; constructor(cells: number[]) { this.cells = cells; } make(from: number, moved: number) { this.undos.push({ from, moved }); } unmake(): void { const undo = this.undos.pop()!; const { from, moved } = undo; this.cells[from] = moved; } }
const values: any[] = [0, 1, -1, 2147483647, -2147483648, 2147483648, 0.5, -0, NaN, Infinity, "x", "3", undefined, null, true, { a: 1 }, 10n];
const keys: any[] = [0, 1, 2, 3, 4, 7, 16, 0.5, -1, -0, NaN, "1", "x", 4294967295, 2147483648, undefined];
const show = (x: any) => Object.is(x, -0) ? "-0" : typeof x === "bigint" ? x + "n" : typeof x === "object" && x ? "o" : typeof x + ":" + String(x);
for (const value of values)
  for (const key of keys) {
    const list: any = new Array<number>(16).fill(0);
    let end = "";
    try { (() => { const b = new Board(list); b.make(key as any, value as any); b.unmake(); })(); } catch (e: any) { end = e.constructor.name; }
    let text = "";
    for (const name of Object.keys(list).slice(0, 24)) text += name + "=" + show(list[name]) + ",";
    console.log(show(value), show(key), end, list.length, text);
  }
