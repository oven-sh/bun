// xs.sort(f) and xs.toSorted(f) call f with the same arguments in the same order as the engine's own sort, whatever f answers, so the result is the engine's also where f is not consistent:
// NaN among the numbers or the keys, an order that is not transitive, answers drawn at random. A comparator that counts or logs sees the same calls. In loops and outside them.
const lines: string[] = [];
let seed = 12345;
function next(): number { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed; }
interface Row { key: number; id: number }
let calls = 0, trail = 0;
function note(a: number, b: number): void { calls++; trail = (Math.imul(trail, 31) + a * 7 + b) | 0; }
function digest(ids: number[]): number { let sum = 0; for (let i = 0; i < ids.length; i++) sum = (Math.imul(sum, 31) + ids[i]) | 0; return sum; }

function make(kind: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    switch (kind) {
      case 0: out.push(next() % 1000); break;
      case 1: out.push(next() % 4); break;
      case 2: out.push(i); break;
      case 3: out.push(n - i); break;
      case 4: out.push(i % 17); break;
      case 5: out.push(i < n / 2 ? i * 2 : (i - (n >> 1)) * 2 + 1); break;
      case 6: out.push(i < n / 2 ? i + n : i); break;
      case 7: out.push(next() % 20 ? i : next() % n); break;
      default: out.push(next() % 5 ? next() % 100 : NaN);
    }
  }
  return out;
}
const kinds = ["random", "few values", "rising", "falling", "teeth", "two runs that interleave", "two runs apart", "nearly in order", "with NaN"];
const lengths = [0, 1, 2, 3, 7, 8, 9, 16, 33, 63, 64, 65, 66, 100, 129, 200, 500, 1100];

for (let kind = 0; kind < kinds.length; kind++) {
  let all = 0, allCalls = 0;
  for (const n of lengths) {
    const keys = make(kind, n);
    const rows: Row[] = keys.map((key, id) => ({ key, id }));
    const mix = (sorted: Row[]): void => { all = (Math.imul(all, 33) + digest(sorted.map(row => row.id)) + trail) | 0; allCalls += calls; calls = 0; trail = 0; };
    mix(rows.slice().sort((a, b) => { note(a.id, b.id); return a.key - b.key; }));
    mix(rows.slice().sort((a, b) => { note(a.id, b.id); return b.key - a.key; }));
    mix(rows.slice().sort((a, b) => { note(a.id, b.id); return a.key < b.key ? -1 : 1; }));
    mix(rows.slice().sort((a, b) => { note(a.id, b.id); return a.key > b.key ? 1 : -1; }));
    mix(rows.slice().sort((a, b) => { note(a.id, b.id); return a.key < b.key ? -1 : 0; }));
    mix(rows.slice().sort((a, b) => { note(a.id, b.id); return (a.key % 7) - (b.key % 5); }));
    mix(rows.slice().sort((a, b) => { note(a.id, b.id); return (next() % 3) - 1; }));
    mix(rows.slice().sort((a, b) => { note(a.id, b.id); return -1; }));
    mix(rows.slice().sort((a, b) => { note(a.id, b.id); return 1; }));
    mix(rows.toSorted((a, b) => { note(a.id, b.id); return a.key - b.key; }));
    mix(rows.toSorted((a, b) => { note(a.id, b.id); return (a.key % 7) - (b.key % 5); }));
    mix(rows.slice().sort(((a: Row, b: Row) => { note(a.id, b.id); return a.key > b.key; }) as unknown as (a: Row, b: Row) => number));
  }
  lines.push("records, " + kinds[kind] + ": " + all + " after " + allCalls + " calls");
}

for (let kind = 0; kind < kinds.length; kind++) {
  let all = 0, allCalls = 0;
  for (const n of lengths) {
    const halves = make(kind, n).map(x => x + 0.5), whole = make(kind, n);
    const mix = (sorted: number[]): void => { let sum = 0; for (const x of sorted) sum = (Math.imul(sum, 31) + (x === x ? x * 2 : -1)) | 0; all = (Math.imul(all, 33) + sum + trail) | 0; allCalls += calls; calls = 0; trail = 0; };
    for (const numbers of [halves, whole]) {
      mix(numbers.slice().sort((a, b) => { note(a * 2, b * 2); return a - b; }));
      mix(numbers.slice().sort((a, b) => { note(a * 2, b * 2); return b - a; }));
      mix(numbers.slice().sort((a, b) => { note(a * 2, b * 2); return a < b ? -1 : 1; }));
      mix(numbers.slice().sort((a, b) => { note(a * 2, b * 2); return (a % 7) - (b % 5); }));
      mix(numbers.slice().sort((a, b) => { note(a * 2, b * 2); return (next() % 3) - 1; }));
      mix(numbers.toSorted((a, b) => { note(a * 2, b * 2); return a - b; }));
      mix(numbers.toSorted((a, b) => { note(a * 2, b * 2); return (a % 7) - (b % 5); }));
      mix(numbers.slice().sort((a, b) => a - b));
      mix(numbers.toSorted((a, b) => b - a));
      mix(numbers.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    }
  }
  lines.push("numbers, " + kinds[kind] + ": " + all + " after " + allCalls + " calls");
}

const once: number[] = [5, 3, 9, 1, 7, 2, 8, 6, 4, 0, 11, 10];
lines.push("outside a loop: " + once.slice().sort((a, b) => { calls++; return a - b; }).join() + " after " + calls + " calls");
lines.push("outside a loop, not transitive: " + once.slice().sort((a, b) => (a % 7) - (b % 5)).join());
lines.push("outside a loop, NaN: " + [3, NaN, 1, 2, NaN, 0, -1, 5, 4].sort((a, b) => a - b).join());
const untyped: any = once.slice();
calls = 0;
lines.push("an untyped receiver: " + untyped.sort((a: any, b: any) => { calls++; return (a % 7) - (b % 5); }).join() + " after " + calls + " calls");

for (const stop of [1, 5, 40, 300, 900, 2500]) {
  const rows: Row[] = make(5, 400).map((key, id) => ({ key, id }));
  calls = 0;
  let said = "no error";
  try { rows.sort((a, b) => { if (++calls === stop) throw new RangeError("call " + calls); return a.key - b.key; }); } catch (error) { said = (error as Error).message; }
  lines.push("a comparator that throws: " + said + ", " + digest(rows.map(row => row.id)));
}
console.log(lines.join("\n"));
