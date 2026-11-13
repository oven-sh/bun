// The bound of a counter is a variable of the module, and something writes it while the loop runs: a turn, a function that the turn calls, code that nobody has seen. Each turn goes by what the variable holds then.
let bound = 0;
function write(next: number) {
  bound = next;
}
function aCallWritesTheBound(next: number): number {
  let sum = 0;
  for (let i = 0; i < bound; i++) {
    sum += i & 7;
    if (i === 3) write(next);
  }
  return sum;
}
function aTurnWritesTheBound(next: number): number {
  let sum = 0;
  for (let i = 0; i < bound; i++) {
    sum += i & 7;
    if (i === 3) bound = next;
  }
  return sum;
}
function anUnknownCallWritesTheBound(next: number): number {
  let sum = 0;
  for (let i = 0; i < bound; i++) {
    sum += i & 7;
    if (i === 3) (globalThis as any).writer(next);
  }
  return sum;
}
(globalThis as any).writer = write;
for (const next of [6, 20, 2.5, 0, NaN, -1]) {
  bound = 12;
  const byCall = aCallWritesTheBound(next);
  bound = 12;
  const byTurn = aTurnWritesTheBound(next);
  bound = 12;
  const byUnknownCall = anUnknownCallWritesTheBound(next);
  console.log(next, byCall, byTurn, byUnknownCall, bound);
}
