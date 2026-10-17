// The positions in a stack are the same however often, in whatever order and from however many places they are asked for.
function lines(stack: string | undefined): string {
  return (stack ?? "").split("\n").map(line => /(\d+):(\d+)\)?$/.exec(line)).filter(found => found !== null).slice(0, 3).map(found => found![1] + ":" + found![2]).join(" ");
}
function first(): string {
  return lines(new Error("first").stack);
}
function second(): string {
  const kept = new Error("second");
  return lines(kept.stack);
}
function both(flag: boolean): string {
  const a = new Error("a"); const b = new Error("b");
  return flag ? lines(a.stack) + " | " + lines(b.stack) : lines(b.stack) + " | " + lines(a.stack);
}
class Made {
  stack: string;
  constructor() {
    this.stack = lines(new Error("in a constructor").stack);
  }
}
function inlined(n: number): string {
  return n ? inlined(n - 1) : lines(new Error("deep").stack);
}
const many: Array<() => string> = [];
for (let i = 0; i < 40; i++) many.push(i % 2 ? () => lines(new Error("odd").stack) : () => lines(new RangeError("even").stack));
const seen = new Set<string>();
let last: string[] = [];
for (let round = 0; round < 60; round++) {
  last = [first(), second(), both(true), both(false), new Made().stack, inlined(3), ...many.map(make => make())];
  seen.add(last.join(" / "));
}
console.log("every round says the same:", seen.size === 1);
console.log("each has a position:", last.every(said => /^\d+:\d+/.test(said)));
console.log("different places, different positions:", new Set(last.slice(0, 6)).size, new Set(last.slice(6)).size);
const [a, b] = both(true).split(" | ");
const [c, d] = both(false).split(" | ");
console.log("whichever is asked first:", a === d, b === c, a !== b);
