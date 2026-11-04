// a small function calls itself through a bound function without end: the stack overflows, the error is caught, and the program goes on
let turns = 0;
let limit = 0;
function step(by: number, n: number): number {
  turns++;
  if (limit && n >= limit) return n;
  return bound(n + by) + 1;
}
const bound = step.bind(null, 1);
function deed() {
  turns = 0;
  try {
    return String(bound(0));
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
limit = 5;
console.log(deed());
