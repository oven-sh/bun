// A loop asks fields for values of their written types. What it calls, which is not copied into it, stores undefined or null into them.
const never: any = JSON.parse("0");
class Cell {
  count: number;
  ratio: number;
  text: string;
  part: { size: number };
  constructor(seed: number) {
    if (never) eval("");
    this.count = seed;
    this.ratio = seed / 3;
    this.text = "t" + seed;
    this.part = { size: seed };
  }
  reset(depth: number, value: any): number {
    if (depth > 0) return this.reset(depth - 1, value) + 1;
    this.count = value;
    this.ratio = value;
    this.text = value;
    this.part = value;
    return 0;
  }
  fill(depth: number): number {
    if (depth > 0) return this.fill(depth - 1) + 1;
    this.count = 5;
    this.ratio = 0.5;
    this.text = "filled";
    this.part = { size: 7 };
    return 0;
  }
}
function clear(cell: Cell, depth: number, value: any): number {
  if (depth > 0) return clear(cell, depth - 1, value) + 1;
  cell.count = value;
  cell.part = value;
  return 0;
}
const told = (value: unknown) => (value === undefined ? "u" : value === null ? "n" : typeof value === "object" ? "o" : String(value));
function numbers(turns: number, value: any): string {
  let seen = "";
  let sum = 0;
  const cell = new Cell(4);
  for (let k = 0; k < turns; k++) {
    const count: unknown = cell.count;
    const ratio: unknown = cell.ratio;
    if (count == null || ratio == null) seen += told(count) + told(ratio);
    else sum += (count as number) + (ratio as number);
    cell.count = 1;
    if (k % 3 === 1) cell.reset(k & 1, value);
    else if (k % 3 === 2) cell.fill(1);
  }
  return seen.slice(0, 12) + " " + sum;
}
function cells(turns: number, value: any): string {
  let seen = "";
  let length = 0;
  const cell = new Cell(4);
  for (let k = 0; k < turns; k++) {
    const text: unknown = cell.text;
    const part: unknown = cell.part;
    if (text == null || part == null) seen += told(text) + told(part);
    else length += (text as string).length + (part as { size: number }).size;
    cell.text = "x";
    if (k % 3 === 1) cell.reset(1, value);
    else if (k % 3 === 2) cell.fill(k & 1);
  }
  return seen.slice(0, 12) + " " + length;
}
function outside(turns: number, value: any): string {
  let seen = "";
  let sum = 0;
  const cell = new Cell(2);
  for (let k = 0; k < turns; k++) {
    const count: unknown = cell.count;
    if (count == null) seen += told(count);
    else sum += count as number;
    cell.count = 3;
    if (k & 1) clear(cell, 1, value);
  }
  return seen.slice(0, 12) + " " + sum + " " + told(cell.part);
}
for (const turns of [1, 4, 301]) {
  for (const value of [undefined, null]) console.log(numbers(turns, value), cells(turns, value), outside(turns, value));
}
