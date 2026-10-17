// Loops that go through an array from its end: from length - 1, from further down, from the length itself and beyond it, down to 0, to 1, to -1 and below, by one and by more; over arrays that shrink, grow or are replaced on the way; over strings.
declare const console: { log(...values: unknown[]): void };
function show(v: number | undefined): number { return v === undefined ? 1000000 : v; }
function fromLast(a: number[]): number { let t = 0; for (let i = a.length - 1; i >= 0; i--) t += a[i]; return t; }
function fromLastAboveMinusOne(a: number[]): number { let t = 0; for (let i = a.length - 1; i > -1; i--) t += a[i]; return t; }
function fromLastToOne(a: number[]): number { let t = 0; for (let i = a.length - 1; i >= 1; i--) t += a[i]; return t; }
function fromLastAboveZero(a: number[]): number { let t = 0; for (let i = a.length - 1; i > 0; i--) t += a[i] - a[i - 1]; return t; }
function fromSecondLast(a: number[]): number { let t = 0; for (let i = a.length - 2; i >= 0; i--) t += a[i] * a[i + 1]; return t; }
function byTwo(a: number[]): number { let t = 0; for (let i = a.length - 1; i >= 0; i -= 2) t += a[i]; return t; }
function byThree(a: number[]): number { let t = 0; for (let i = a.length - 3; i >= 0; i -= 3) t += a[i] + a[i + 2]; return t; }
function fromLength(a: number[]): number { let t = 0; for (let i = a.length; i >= 0; i--) t += show(a[i]); return t; }
function fromBeyond(a: number[]): number { let t = 0; for (let i = a.length + 1; i >= 0; i--) t += show(a[i]); return t; }
function toMinusOne(a: number[]): number { let t = 0; for (let i = a.length - 1; i >= -1; i--) t += show(a[i]); return t; }
function toMinusTwo(a: number[]): number { let t = 0; for (let i = a.length - 1; i > -3; i--) t += show(a[i]); return t; }
function whileLoop(a: number[]): number { let t = 0; let i = a.length; while (i-- > 0) t += a[i]; return t; }
function whileFromLast(a: number[]): number { let t = 0; let i = a.length - 1; while (i >= 0) { t += a[i]; i--; } return t; }
function ofAnother(a: number[], b: number[]): number { let t = 0; for (let i = a.length - 1; i >= 0; i--) t += show(b[i]); return t; }
function shrinking(a: number[]): number { let t = 0; for (let i = a.length - 1; i >= 0; i--) { t += show(a[i]); if (i === 3) a.length = 1; } return t; }
function popping(a: number[]): number { let t = 0; for (let i = a.length - 1; i >= 0; i--) { t += show(a[i]); if (i & 1) a.pop(); } return t + a.length; }
function growing(a: number[]): number { let t = 0; for (let i = a.length - 1; i >= 0; i--) { t += a[i]; if (i === 2) a.push(0.5); } return t + a.length; }
function replaced(a: number[]): number { let t = 0; for (let i = a.length - 1; i >= 0; i--) { t += show(a[i]); if (i === 2) a = [7]; } return t; }
function storing(a: number[]): number { for (let i = a.length - 1; i >= 0; i--) a[i] = a[i] * 2 + i; return a.length ? a[0] + a[a.length - 1] : -1; }
function shifting(a: number[]): number { for (let i = a.length - 1; i > 0; i--) a[i] = a[i - 1]; return fromLast(a); }
function lastIndexWhere(a: number[], least: number): number { for (let i = a.length - 1; i >= 0; i--) if (a[i] >= least) return i; return -1; }
function texts(a: string[]): string { let t = ""; for (let i = a.length - 1; i >= 0; i--) t += a[i]; return t; }
function codes(s: string): number { let t = 0; for (let i = s.length - 1; i >= 0; i--) t = (t * 31 + s.charCodeAt(i)) | 0; return t; }
function nested(rows: number[][]): number { let t = 0; for (let r = rows.length - 1; r >= 0; r--) { const row = rows[r]; for (let i = row.length - 1; i >= 0; i--) t += row[i] * (r + 1); } return t; }
const halves = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 0.5); const whole = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);
for (const make of [halves, whole]) for (const n of [0, 1, 2, 3, 4, 5, 8, 33, 1000]) {
  console.log(n, fromLast(make(n)), fromLastAboveMinusOne(make(n)), fromLastToOne(make(n)), fromLastAboveZero(make(n)), fromSecondLast(make(n)), byTwo(make(n)), byThree(make(n)), fromLength(make(n)), fromBeyond(make(n)), toMinusOne(make(n)), toMinusTwo(make(n)), whileLoop(make(n)), whileFromLast(make(n)));
  console.log(n, ofAnother(make(n), make(n >> 1)), ofAnother(make(n >> 1), make(n)), shrinking(make(n)), popping(make(n)), growing(make(n)), replaced(make(n)), storing(make(n)), shifting(make(n)), lastIndexWhere(make(n), n >> 1), lastIndexWhere(make(n), n + 2), nested([make(n), [], make(2)]));
}
console.log(texts(["a", "b", "c"]), texts([]), codes("héllo"), codes(""), codes("x".repeat(50)));
