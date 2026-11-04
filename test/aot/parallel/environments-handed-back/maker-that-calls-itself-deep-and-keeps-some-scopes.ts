// Flags: --aot-check=Validate
// Each depth of the recursion has a scope of its own. On the way back they are handed back one by one, but for those that an arrow keeps; the next descent takes them in another order.
const kept: Array<() => string> = [];
function descend(depth: number, label: string): number {
  let sum = depth;
  let text = label + depth;
  function add(n: number) {
    sum += n;
    text += ".";
  }
  add(1);
  if (depth % 3 === 0 && depth > 0) kept.push(() => text + "=" + sum);
  if (depth > 0) add(descend(depth - 1, label));
  add(1);
  return sum;
}
const results: number[] = [];
for (let turn = 0; turn < 5; turn++) results.push(descend(7 + turn, "abcde"[turn]));
console.log(results.join(" "));
console.log(kept.map(read => read()).join(" "));
function both(depth: number): number {
  let here = depth * 10;
  function bump() {
    here++;
  }
  bump();
  if (depth === 0) return here;
  const left = both(depth - 1);
  bump();
  const right = both(depth - 1);
  bump();
  return here + left - right;
}
console.log(both(6), both(3), both(6));
