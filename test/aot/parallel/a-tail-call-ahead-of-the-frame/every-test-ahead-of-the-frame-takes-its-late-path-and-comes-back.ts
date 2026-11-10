// A tail call that must follow a test of the stack compares the stack pointer with the bound itself where it stands ahead of the framed part. Here
// that test fails every time and every poll comes back with nothing to do: the late path sets the frame up, tears it down and takes the jump,
// with eight operands in registers, two of them doubles.
// Env: BUN_JSC_forceTrapAwareStackChecks=1
class Item { kind: number; size: number; constructor(kind: number, size: number) { this.kind = kind; this.size = size; } }
function heavy(size: number): number { return size <= 0 ? 0 : size + heavy(size - 1); }
function wide(a: Item, b: number, c: number, d: number, e: number, f: number, x: number, y: number): number { const first = heavy(a.size); const second = heavy(a.kind); return first + second + b * 2 + c * 3 + d * 5 + e * 7 + f * 11 + x * 0.5 + y * 0.25 - first - second; }
function route(item: Item, seed: number): number {
  if (item.kind & 1) return wide(item, seed + 1, seed + 2, seed + 3, seed + 4, seed + 5, seed + 0.5, seed + 0.25);
  const first = heavy(item.size); const second = item.size > 1 ? route(new Item(item.kind | 1, item.size - 1), seed) : heavy(item.size); return first + second;
}
function twice(item: Item, seed: number): number { const first = route(item, seed); const second = route(item, seed); if (first !== second) throw new Error("two answers"); item.size = item.size | 0; return first; }
let answers = 0, overflows = 0, total = 0;
function down(item: Item, depth: number): number {
  let here = 221.3125;
  try { here = twice(item, 4); answers++; } catch (error) { if (!(error instanceof RangeError)) throw error; overflows++; }
  if (here !== 221.3125) throw new Error("a wrong answer at depth " + depth);
  return down(item, depth + 1) + 0;
}
function padded(item: Item, pads: number): number { return pads > 0 ? padded(item, pads - 1) + 0 : attempt(item); }
function attempt(item: Item): number { try { return down(item, 0); } catch (error) { if (!(error instanceof RangeError)) throw error; return -1; } }
for (let seed = 0; seed < 300; seed++) total += route(new Item(1, 3), seed);
for (let pads = 0; pads < 4; pads++) padded(new Item(1, 3), pads);
console.log(total, answers > 0, overflows > 0, route(new Item(4, 3), 4));
