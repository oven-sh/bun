// Under: --aot-testing=CheckBoundsAtRunTime: every read of an element is checked against its array
let count = 0;
function next(): number { return ++count % 5; }
function boom(value: any): any { if (value === 3) throw new TypeError("boom " + value); return value; }
const extra = [10, 11];
const kept: (() => string)[] = [];
function run(a: any, b: any, cells: any[], o: any): string {
  let total = 0;
  let hits = 0;
  let text = "";
  outer: for (const x of [a, next(), boom(b)]) {
    if (x === b) throw new Error('at ' + total); total += 2;
  }
  return [total, hits, text, a, b, o.x, o.y, count].join(" ");
}
const inputs: any[] = [0, 1, -1, 2, 3, 2.5, "x", undefined, null, NaN, 2 ** 31];
for (const a of inputs)
  for (const b of inputs) {
    const cells: any[] = [3, 1, 3, 4, , 3];
    let line: string;
    try { line = run(a, b, cells, { x: 1, y: a }); } catch (e: any) { line = "threw " + (e && e.message ? e.message : String(e)); }
    console.log(String(a), String(b), line, cells.length, cells.join("/"));
  }
console.log(kept.map(f => { try { return f(); } catch (e: any) { return e.message; } }).join());
