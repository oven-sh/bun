// A value that comes round a loop and may be undefined: chains through views and arrays, state machines, the greatest so far.
const next = new Int32Array([3, 5, 1, 0, 2, 9, -1, 4]), states = [0, 1, 2, 0, 2, 3, 1, 1, 3, 0, 0, 2, 3, 3, 1, 0];
const input = new Uint8Array(60).map((_, i) => (i * i) & 3);
function machine(): number { let s = 0, n = 0; for (let i = 0; i < input.length; i++) { s = states[(s << 2) | input[i]!]!; if (s === 3) n++; } return n * 10 + s; }
function follow(view: Int32Array, from: number, steps: number): string { let x: number | undefined = from; for (let i = 0; i < steps; i++) x = view[x as number]; return String(x) + typeof x + (x === undefined ? "!" : x + 1); }
function root(parent: number[], x: number): number { while (parent[x] !== x) { parent[x] = parent[parent[x]!]!; x = parent[x]!; } return x; }
function greatest(list: readonly number[]): number | undefined { let best: number | undefined; for (const v of list) if (best === undefined || v > best) best = v; return best; }
function falls(list: readonly number[]): number { let last: number | undefined, n = 0; for (let i = 0; i <= list.length; i++) { const v = list[i]; if (last !== undefined && v !== undefined && v < last) n++; last = v; } return n + (last === undefined ? 100 : 0); }
class Entry { value: number | undefined = 0; held: unknown = 0; }
function kept(view: Int32Array, from: number): string { const e = new Entry(); let x: number | undefined = from; const seen = new Set<number | undefined>(); for (let i = 0; i < 6; i++) { e.value = x; e.held = x; seen.add(x); x = view[x as number]; } return JSON.stringify(e) + seen.size + seen.has(undefined) + x; }
for (let round = 0; round < 3; round++) {
  console.log(machine(), [0, 1, 3, 6, 7, 8, -1].map(a => follow(next, a, 5)).join(), kept(next, 1), kept(next, 6));
  console.log(root([0, 0, 1, 2, 3, 5, 5], 4), root([0, 0, 1, 2, 3, 5, 5], 6), greatest([]), greatest([-5, -2, -9]), greatest([1, 4294967296, 2]), greatest([0.5, NaN, 2]), falls([3, 1, 2, 2, 0]), falls([]));
  next[round] = round + 4;
}
export {};
