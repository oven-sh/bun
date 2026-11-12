// A declared function that its owner reads as a value is made where the first read runs. The way out in front of that read makes neither the closure nor a scope for what the closure reads.
// COUNT: operation:operationAOTAllocateSlow <= 100
function reaches(from: number, to: number, steps: number[]): boolean {
  if (from === to) return true;
  const seen = new Set<number>();
  return steps.some(visit);
  function visit(step: number): boolean {
    if (seen.has(step)) return false;
    seen.add(step);
    return from + step === to;
  }
}
const steps = [1, 2, 3];
let same = 0;
for (let turn = 0; turn < 2_000_000; turn++) if (reaches(turn, turn, steps)) same++;
console.log(same, reaches(1, 3, steps), reaches(1, 9, steps));
