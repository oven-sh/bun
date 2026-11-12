// The type argument says what a function without a body is expected to give. No parser answers that call, so the type keeps its proofs.
declare const process: { readonly argv: readonly string[] };
declare function answer<T>(): T;
export {};
(globalThis as any).answer = () => JSON.parse('{"total":5,"count":"two"}');
interface Sum { total: number; count: number }
function fold(list: number[]): Sum {
  const held: Sum = { total: 0, count: 0 };
  for (let i = 0; i < list.length; i++) { held.total += list[i]!; held.count += 1; }
  return held;
}
const list: number[] = [1, 2, 3, 4];
const turns = +(process.argv[2] ?? 1000);
const other = answer<Sum>();
let total = 0, count = 0;
for (let turn = 0; turn < turns; turn++) { const sum = fold(list); total = (total + sum.total) % 1000003; count = (count + sum.count) % 1000003; }
console.log("SAID " + total + " " + count + " " + other.total + " " + typeof other.count);
