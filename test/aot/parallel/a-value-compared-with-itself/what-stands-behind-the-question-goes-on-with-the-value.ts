// The value that was asked is used behind the question, on both sides, beside other values that live across it; the question stands in a loop, behind a call, in a condition with other terms and as an operand.
const NONE = -0x80000000;
function asWord(n: number): number {
  return n !== n ? NONE : n;
}
function four(a: number, b: number, c: number, d: number, into: Int32Array): number {
  into[0] = asWord(a);
  into[1] = asWord(b);
  into[2] = asWord(c);
  into[3] = asWord(d);
  return (a === a ? 1 : 0) + (b === b ? 2 : 0) + (c === c ? 4 : 0) + (d === d ? 8 : 0);
}
function both(a: unknown, b: unknown): string {
  if (a === a && b === b) return "both";
  if (a !== a && b !== b) return "neither";
  return a === a ? "first" : "second";
}
function sumOfKnown(list: unknown[]): number {
  let sum = 0;
  for (const x of list) if (x === x && typeof x === "number") sum += x;
  return sum;
}
function asOperand(x: unknown): number {
  return Number(x === x) * 2 + Number(x !== x);
}
(globalThis as any).kit = { four, both, sumOfKnown, asOperand };
const kit = (globalThis as any).kit;
const into = new Int32Array(4);
const some = [1, NaN, 2.75, -3, NaN, 0, 4e9, NaN];
const out: string[] = [];
for (let i = 0; i < 16; i++) {
  const bits = kit.four(some[i & 7], some[(i + 1) & 7], some[(i + 3) & 7], some[(i * 5) & 7], into);
  out.push(bits + ":" + Array.from(into).join("/"));
}
console.log(out.join(" "));
console.log(kit.both(1, "x"), kit.both(NaN, NaN), kit.both(NaN, {}), kit.both(null, NaN), kit.both(0.5, 0.25));
console.log(kit.sumOfKnown([1, NaN, "2", 3.5, null, NaN, -0, 10n, 4]), kit.asOperand(NaN), kit.asOperand(1), kit.asOperand("NaN"), kit.asOperand(undefined), kit.asOperand(0.1));
