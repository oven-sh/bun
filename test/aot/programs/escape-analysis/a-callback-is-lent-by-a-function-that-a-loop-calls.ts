// A function without a loop hands a callback to one of several callees, one of which keeps it. A loop calls the function, straight and behind a branch. The output is that of plain Bun.
type Visit = (value: number) => void;
const keptCallbacks: Visit[] = [];
function twice(visit: Visit): void { visit(3); visit(9); }
function backward(visit: Visit): void { visit(9); visit(3); }
function thrice(visit: Visit): void { visit(1); visit(9); visit(2); }
function once(visit: Visit): void { visit(9); }
function never(_visit: Visit): void {}
function keeps(visit: Visit): void { visit(5); if (keptCallbacks.length < 4) keptCallbacks.push(visit); }
function throws(visit: Visit): void { visit(6); throw new RangeError("stop"); }
const callees: any[] = [twice, backward, thrice, once, never, keeps, throws, Math.abs];
const enabled: boolean = callees.length > 1;

function sumAbove(run: any, limit: number): number {
  let sum = 0;
  run((value: number) => { if (value > limit) sum += value; });
  return sum;
}
function sumBelow(run: any, limit: number): number {
  let sum = 0;
  run((value: number) => { if (value < limit) sum += value; });
  return sum;
}
function attempt(sumOf: (run: any, limit: number) => number, run: any, limit: number): number {
  try {
    return sumOf(run, limit);
  } catch (error) {
    return (error as Error).message.length;
  }
}

let total = 0;
for (let i = 0; i < 4000; i++) {
  if ((i & 7) !== 6) total += sumAbove(callees[i & 7], i & 3);
}
for (let i = 0; i < 4000; i++) {
  const run = callees[(i & 7) === 6 ? 0 : i & 7];
  total += sumBelow(run, i & 15);
}
total += attempt(sumAbove, throws, 1) + attempt(sumBelow, throws, 9);
console.log(total, enabled, keptCallbacks.length);
for (const visit of keptCallbacks) visit(100);
console.log(new Set(keptCallbacks).size);
