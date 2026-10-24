// A function with many identical `return` statements after calls, next to one whose returns all differ: shared epilogues must not change the result.
declare const console: { log(...v: unknown[]): void };
class N { constructor(public kind: number, public flags: number, public next: N | null) {} }
const seen: number[] = [];
function note(k: number): number { let s = 0; for (let i = 0; i < 3; i++) { seen.push(k + i); s += seen.length; } return s; }
// Six times `return -1` after calls: the function has a frame, and each return has an epilogue.
function same(n: N, limit: number): number {
  let s = note(n.kind);
  if (n.kind === 1) { if (s > limit) return -1; s += note(1); }
  if (n.kind === 2) { if (s > limit + 1) return -1; s += note(2); }
  if (n.kind === 3) { if (s > limit + 2) return -1; s += note(3); }
  if (n.flags & 1) { if (s > limit + 3) return -1; s += note(4); }
  if (n.flags & 2) { if (s > limit + 4) return -1; s += note(5); }
  if (n.flags & 4) { if (s > limit + 5) return -1; s += note(6); }
  return s;
}
// The same shape, every return another number: nothing is the same to the letter.
function differ(n: N, limit: number): number {
  let s = note(n.kind);
  if (n.kind === 1) { if (s > limit) return -1; s += note(1); }
  if (n.kind === 2) { if (s > limit + 1) return -2; s += note(2); }
  if (n.kind === 3) { if (s > limit + 2) return -3; s += note(3); }
  if (n.flags & 1) { if (s > limit + 3) return -4; s += note(4); }
  if (n.flags & 2) { if (s > limit + 4) return -5; s += note(5); }
  if (n.flags & 4) { if (s > limit + 5) return -6; s += note(6); }
  return s;
}
let a = 0, b = 0, c = 0, d = 0;
for (let i = 0; i < 400; i++) {
  const n = new N(i % 5, i % 9, null), x = same(n, 100000 + (i % 7) * 900), y = differ(n, 100000 + (i % 7) * 900);
  if (x < 0) a++; else b += x & 1023;
  if (y < 0) c += y; else d += y & 1023;
  if (seen.length > 5000) seen.length = 0;
}
console.log(a, b, c, d);
for (let i = 0; i < 40; i++) { const n = new N(i % 5, i % 9, null); console.log(same(n, i * 40), differ(n, i * 40)); }
