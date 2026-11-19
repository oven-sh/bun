// A counter that steps by constants beside the counter of its loop lies within as many steps as the loop turns: out[n++], a stack's top, steps in several arms, downward, behind the loop.
// STATISTIC: SecondCountersBounded >= 6
const a = new Int32Array([1, 2, 3, 4, 5, 6, 7, 9]);
const list = [2, 9, 4, 1, 5, 2, 6];
const text = "abcdefgh";

function filtered(out: Int32Array): number { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] & 1) out[n++] = a[i]; return n; }
function compacted(values: number[]): number { let n = 0; for (let i = 0; i < values.length; i++) if (values[i] !== 5) values[n++] = values[i]; values.length = n; return n; }
function encoded(out: Uint8Array): number { let n = 0; for (let i = 0; i < 8; i++) { if (a[i] < 4) out[n++] = a[i]; else { out[n++] = 128 | a[i]; out[n++] = i; } } return n; }
function stacked(start: number): string { const items = new Int32Array(12); let top = start; for (let k = 0; k < 9; k++) { items[top++] = k; items[top++] = 7; const one = items[--top]; items[top - 1] = one + items[top - 1]; } return top + ":" + items.join(); }
function downward(out: Int32Array): number { let n = 8; for (let i = 8; i > 0; i--) { out[--n] = i; if (i === 4) n--; } return n; }
function strided(): number { let n = 0, sum = 0; for (let i = 0; i < 9; i += 2) { sum = (sum + text.charCodeAt(n)) | 0; n += 2; } return sum * 100 + n; }
function skipped(limit: number): number { let n = 0; for (let i = 0; i < limit; i++) { if (i & 1) continue; n++; if (i === 3) i++; n += 3; } return n; }
function behind(out: Int32Array): string { let n = 0; for (let i = 0; i < 4; i++) n += 2; for (let q = 0; q < 3; q++) out[n++] = q; return n + ":" + out.join(); }
function edge(start: number): number { let n = start; for (let i = 0; i < 5; i++) n++; return n; }
function reset(): number { let n = 0, most = 0; for (let i = 0; i < 9; i++) { if (a[i & 7] === 4) n = 0; else n++; most = Math.max(most, n); } return most * 10 + n; }
function nested(): number { let n = 0; for (let i = 0; i < 4; i++) for (let k = 0; k < i; k++) n++; return n; }
function caught(): number { let n = 0; for (let i = 0; i < 6; i++) { try { n++; if (i === 2) throw i; n++; } catch { n += 10; } } return n; }
function fractional(): number { let n = 0; for (let i = 0; i < 4; i++) n += i === 2 ? 0.5 : 1; return n; }
class Stack {
  items = new Int32Array(64);
  top = 0;
  push(value: number): void { this.items[this.top++] = value; }
  pop(): number { return this.items[--this.top]; }
}
function reckon(turns: number, start: number): string {
  const s = new Stack();
  s.top = start;
  for (let k = 0; k < 20; k++) { s.push(k); s.push(turns); s.push(s.pop() + s.pop()); }
  return s.top + ":" + s.pop() + ":" + s.items.subarray(0, 8).join();
}
function emptied(s: Stack): number { let sum = 0; for (let k = 0; k < 6; k++) sum = (sum + s.pop()) | 0; return sum * 100 + s.top; }

const ints = new Int32Array(12);
for (let round = 0; round < 2; round++) {
  console.log(filtered(ints), ints.join(), compacted([5, 1, 5, 2, 3, 5]), compacted(list.slice()), encoded(new Uint8Array(20)));
  console.log(stacked(0), stacked(3), stacked(-1), stacked(2147483646), stacked(0.5));
  console.log(downward(ints), ints.join(), strided(), skipped(10), skipped(0), skipped(-3), behind(ints));
  for (const start of [0, 2147483645, -2147483648, 9007199254740989, 0.25, -0, NaN]) console.log(edge(start));
  console.log(reset(), nested(), caught(), fractional(), reckon(3, 0), reckon(3, -2), reckon(3, 60), reckon(3, 2147483647));
  const s = new Stack();
  s.push(4);
  s.push(5);
  console.log(emptied(s), s.top);
}
export {};
