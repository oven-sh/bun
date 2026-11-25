// Elements of views, in bounds and out of bounds, passed to functions that take numbers.
function add(a: number, b: number): number { return (a + b) | 0; }
function kind(a: number): string { return typeof a; }
function binary(op: number, a: number, b: number): number {
  switch (op) {
    case 0: return a + b;
    case 1: return a - b;
    case 2: return Math.imul(a, b);
    case 3: return a < b ? 1 : 0;
    case 4: return a === b ? 1 : 0;
    case 5: return (a / b) | 0;
    case 6: return a % b;
    default: return a;
  }
}
function run(ops: Uint8Array, stack: Int32Array, n: number): string {
  let sum = 0, kinds = "";
  for (let i = 0; i < n; i++) {
    sum = (sum + add(stack[i]!, stack[i + 1]!)) | 0;
    kinds += kind(stack[i]!)[0];
    sum = (sum ^ binary(ops[i]!, stack[n - i]!, stack[i + 2]!)) | 0;
  }
  return sum + kinds;
}
function outside(ops: Uint8Array, stack: Int32Array, i: number): string {
  return add(stack[i]!, stack[i + 1]!) + kind(stack[i]!) + binary(ops[i]!, stack[i]!, stack[i + 1]!);
}
const ops = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 255]), stack = Int32Array.from([0, 1, -1, 7, 2147483647, -2147483648, 3, 5, 100]);
for (const n of [0, 1, 5, 9, 12]) console.log(n, run(ops, stack, n));
for (const i of [0, 3, 7, 8, 9, -1, 1.5, NaN]) console.log(i, outside(ops, stack, i));
export {};
