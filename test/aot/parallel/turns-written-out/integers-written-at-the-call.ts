function repeat(text: string, times: number): string { let s = ""; for (let i = 0; i < times; i++) s += text; return s; }
function sumTo(n: number): number { let s = 0; for (let i = 1; i <= n; i++) s += i; return s; }
function countdown(from: number, to: number = 0): number { let s = 0; for (let i = from; i > to; i--) s = s * 2 + i; return s; }
function clamps(n: number): number { if (n > 2) n = 2; let s = 0; for (let i = 0; i < n; i++) s += 5; return s; }
function through(n: number): number { return sumTo(n) + sumTo(3); }
function stepIsZero(n: number, step: number): number { let s = 0; for (let i = 0; i < n; i += step) { s++; if (s > 4) break; } return s; }
function twoKinds(n: number): number | string { if (n === 0) return "zero"; let s = 0; for (let i = 0; i < n; i++) s += i; return s; }
let carried = 0;
let last: number | string = 0;
for (let turn = 0; turn < 30; turn++) {
  carried += repeat("ab", 3).length + repeat("x", 0).length + repeat("y", 8).length + repeat("z", 9).length + repeat("w", -1).length + sumTo(4) + sumTo(0) + sumTo(turn & 3);
  carried += countdown(3) + countdown(5, 2) + countdown(0) + clamps(7) + clamps(1) + through(2) + stepIsZero(3, 0) + stepIsZero(3, 2) + (twoKinds(3) as number);
  last = twoKinds(turn & 1);
}
console.log(carried, last, twoKinds(0), repeat("ab", 2), sumTo(2147483647 - 2147483647), countdown(2, -2));
