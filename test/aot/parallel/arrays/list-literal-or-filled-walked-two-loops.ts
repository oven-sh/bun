// A list that is either a literal or filled by a loop is walked by two for-of loops, one in the other, in a loop. One loop serves every kind of iteration, and the index is there only for arrays: no test looks at it where the kind is another. The verifiers run behind every pass.
// Flags: --aot-verify-each-pass
declare const console: { log(...values: unknown[]): void };
function check(name: string, got: number): void { if (got < 0) console.log(name); }
const lengths: number[] = []; for (let n = 0; n <= 40; n++) lengths.push(n);
let sum = 0;
for (const n of lengths) {
  const bounds: number[] = n <= 12 ? [] : [0, 1, 2, 3, n >> 1, n - 1, n, n + 1, -1, -n];
  if (n <= 12) for (let b = -n - 1; b <= n + 1; b++) bounds.push(b);
  for (const i of bounds) for (const j of bounds) { const at = " " + n + " (" + i + ", " + j + ")"; check("x" + at, i + j + 100); sum += i * j; }
}
console.log(sum);
