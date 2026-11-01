import type { int32 } from "bun";
const show = (v: number): string => (Object.is(v, -0) ? "-0" : String(v));
const values: int32[] = [0, 1, -1, 2, -2, 3, -3, 7, -7, 40, 65537, 2147483647, -2147483647, -2147483648];

function remainder(x: int32, y: int32): number {
  return x % y;
}
function remainderCut(x: int32, y: int32): int32 {
  return x % y | 0;
}
function remainderAdded(x: int32, y: int32, z: int32): number {
  return z + (x % y);
}
function remainderStored(a: Int32Array, x: int32, y: int32): int32 {
  a[0] = a[0]! + (x % y);
  return a[0]!;
}
function remainderOfCount(x: int32, y: int32): number {
  return (x & 0x7fffffff) % y;
}
function quotient(x: int32, y: int32): int32 {
  return (x / y) | 0;
}
function summed(a: Int32Array, u: int32, n: int32): string {
  for (let i = 0; i < a.length; i++) for (let j = -n | 0; j < n; j++) a[i] = a[i]! + (j % u);
  return a.join();
}
function counted(a: Int32Array, u: int32, n: int32): string {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < n; j++) a[i] = a[i]! + (j % u);
    a[i]! += 5;
  }
  return a.join();
}
function divided(a: Int32Array, u: int32, n: int32): string {
  for (let i = 0; i < a.length; i++) for (let j = -n | 0; j < n; j++) a[i] = a[i]! + ((j / u) | 0);
  return a.join();
}

const out: string[] = [];
for (const y of values) {
  for (const x of values)
    out.push(
      [
        x,
        y,
        show(remainder(x, y)),
        remainderCut(x, y),
        show(remainderAdded(x, y, -7)),
        show(remainderAdded(x, y, 2147483647)),
        remainderStored(new Int32Array([2147483647]), x, y),
        show(remainderOfCount(x, y)),
        quotient(x, y),
      ].join(" "),
    );
  out.push(
    summed(new Int32Array(2), y, 50),
    counted(new Int32Array([0, 2147483600]), y, 50),
    divided(new Int32Array(2), y, 50),
  );
}
console.log(out.join("\n"));
