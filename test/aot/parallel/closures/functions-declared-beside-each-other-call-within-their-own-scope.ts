// Functions that are declared in one scope call each other out of its slots. Each making of the scope has its own: what one counts the other does not see.
type Checker = { total(count: number): number; calls(): number; reduce(n: number): number; viaOther(other: Checker, n: number): number };
function createChecker(limit: number, step: number): Checker {
  let calls = 0;
  const seen: number[] = [];
  function isSmall(n: number): boolean { calls += step; return n < limit; }
  function reduce(n: number): number { return isSmall(n) ? n : reduce(half(n)); }
  function half(n: number): number { seen.push(n); return n >> 1; }
  function total(count: number): number { let sum = 0; for (let i = 0; i < count; i++) sum += reduce(i); return sum + seen.length; }
  function viaOther(other: Checker, n: number): number { return other.reduce(n) * 1000 + reduce(n); }
  return { total, calls: () => calls, reduce, viaOther };
}
const small = createChecker(10, 1), large = createChecker(1000, 100);
console.log(small.total(200), small.calls(), large.total(200), large.calls());
console.log(small.viaOther(large, 500), large.viaOther(small, 500), small.calls(), large.calls());

// A scope for each turn of a loop.
const turns: Array<() => string> = [];
for (let turn = 0; turn < 3; turn++) {
  let hits = 0;
  function bump(): number { return ++hits + turn * 10; }
  function twice(): string { return bump() + ":" + bump(); }
  turns.push(twice);
}
console.log(turns.map(f => f()).join(), turns.map(f => f()).join());

// A function that calls itself, one that is called in front of a `let` of its scope, and one that is handed out and comes back as a value.
function nest(depth: number): string {
  function down(n: number): string { return n ? down(n - 1) + n : label(); }
  function early(): string { try { return late; } catch (error) { return (error as Error).name; } }
  const first = early();
  const late = "late";
  function label(): string { return "[" + depth + first + early() + "]"; }
  function apply(f: (n: number) => string, n: number): string { return f(n); }
  return apply(down, depth) + (depth ? nest(depth - 1) : "");
}
console.log(nest(2));

// Generators and async functions beside each other.
function makeSteps(base: number) {
  function* inner(n: number) { for (let i = 0; i < n; i++) yield offset(i); }
  function offset(i: number) { return base + i; }
  function* outer() { yield* inner(2); base += 100; yield* inner(2); }
  async function later() { const before = offset(0); await null; return before + ":" + offset(0); }
  return { outer, later, raise() { base += 1000; } };
}
const steps = makeSteps(1), otherSteps = makeSteps(5);
console.log([...steps.outer()].join(), [...otherSteps.outer()].join());
const waiting = steps.later();
steps.raise();
console.log(await waiting, await otherSteps.later());

// A declared function that is assigned to is like any variable.
function swapped(flag: boolean) {
  function pick() { return "first"; }
  function other() { return "second"; }
  function ask() { return pick(); }
  const before = ask();
  if (flag) (pick as any) = other;
  return before + ask();
}
console.log(swapped(false), swapped(true));
