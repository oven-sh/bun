// Keys of flat grids: the width is a number out of a variable, a parameter or JSON.parse, and the key may be truncated.
const lines: string[] = [];
const width: number = JSON.parse("5");
let changing: number = JSON.parse("5");
const fraction: number = JSON.parse("2.5");
const text: any = JSON.parse('"3"');
const list: number[] = [];
for (let i = 0; i < 40; i++) list.push(i * 3);
const bytes = new Uint8Array(40).map((_, i) => i * 7);

function at(g: number[], w: number, x: number, y: number): number {
  return g[y * w + x] ?? -1;
}
function atBytes(g: Uint8Array, w: number, x: number, y: number): number {
  return g[(y * w + x) | 0] ?? -1;
}
function sums(): string {
  let a = 0, b = 0, c = 0, d = 0, e = "";
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 5; x++) {
      a += at(list, width, x, y);
      b += atBytes(bytes, width, x, y);
      c += at(list, fraction, x, y);
      d += list[y * width + x] ?? -3;
      e += list[y * text + x] ?? "-";
    }
  }
  return [a, b, c, d, e].join();
}
function moved(): string {
  let s = 0;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 5; x++) {
      s += list[y * changing + x] ?? -7;
      if (x === 3) changing = changing === 5 ? 2.5 : changing === 2.5 ? -1 : changing === -1 ? NaN : 5;
    }
  }
  return String(s);
}
function cut(g: number[], w: number): number {
  let s = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) s += g[(y * w + x) | 0] ?? -2;
  return s;
}
function cutBase(g: number[], w: number): number {
  let s = 0;
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) s += g[((y * w) | 0) + x] ?? -2;
  return s;
}
function stores(g: number[], w: number): string {
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) g[(y * w + x) | 0] = y - x;
  return g.slice(0, 12).join() + ":" + g.length;
}
class Grid {
  constructor(readonly data: number[], readonly w: number) {}
  get(x: number, y: number): number {
    return this.data[(y * this.w + x) | 0] ?? -9;
  }
  sum(): number {
    let s = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) s += this.get(x, y);
    return s;
  }
}
lines.push(sums(), moved(), moved(), moved(), sums());
const widths: number[] = JSON.parse("[5, 4, 1, 0, 2.5, -2, 2147483647, 2147483648, 4294967296, 1e300, 1048576, 1048577]");
for (const w of [...widths, -0, NaN, Infinity, "4" as any, undefined as any, null as any, [3] as any]) {
  lines.push([String(w), cut(list, w), cutBase(list, w), stores([7, 7, 7, 7], w), new Grid(list, w).sum(), at(list, w, 2, 1)].join(" "));
}
console.log(lines.join("\n"));
export {};
