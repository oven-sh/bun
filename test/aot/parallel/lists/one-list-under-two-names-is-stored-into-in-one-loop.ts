function both(a: unknown[], b: unknown[]): void {
  for (let i = 0; i < a.length && i < b.length; i++) {
    a[i] = 1;
    b[i] = 0.5;
  }
}
function bothTheOtherWay(a: unknown[], b: unknown[]): void {
  for (let i = 0; i < a.length && i < b.length; i++) {
    a[i] = 0.5;
    b[i] = 1;
  }
}
function doubledOneAhead(to: number[], from: number[]): void {
  for (let i = 0; i + 1 < from.length && i + 1 < to.length; i++) to[i + 1] = from[i]! * 2;
}
function filledWhileSummed(to: unknown[], from: number[]): number {
  let sum = 0;
  for (let i = 0; i < from.length && i < to.length; i++) {
    to[i] = 3;
    sum += from[i]!;
  }
  return sum;
}
const made: Record<string, () => unknown[]> = {
  int32s: () => Array.from({ length: 13 }, (_, i) => i + 1),
  fractions: () => Array.from({ length: 13 }, (_, i) => i + 0.5),
  boxed: () => { const l: unknown[] = Array.from({ length: 13 }, (_, i) => i); l.push("x"); l.pop(); return l; },
  written: () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
};
for (const first of Object.keys(made)) {
  const one = made[first]!();
  both(one, one);
  console.log("both", first, one.join());
  const other = made[first]!();
  bothTheOtherWay(other, other);
  console.log("the other way", first, other.join());
  const carried = made[first]!() as number[];
  doubledOneAhead(carried, carried);
  console.log("one ahead", first, carried.join());
  const summed = made[first]!();
  console.log("summed", first, filledWhileSummed(summed, summed as number[]), summed.join());
  for (const second of Object.keys(made)) {
    const a = made[first]!(), b = made[second]!();
    both(a, b);
    console.log("both", first, second, a.join(), b.join());
    const to = made[first]!() as number[], from = made[second]!() as number[];
    doubledOneAhead(to, from);
    console.log("one ahead", first, second, to.join());
    const filled = made[first]!();
    console.log("summed", first, second, filledWhileSummed(filled, made[second]!() as number[]), filled.join());
  }
}
