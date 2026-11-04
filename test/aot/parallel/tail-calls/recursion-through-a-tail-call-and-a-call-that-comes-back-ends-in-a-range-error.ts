// of a ring of two small functions one leaves by a tail call and the other comes back for the result, without end: the stack overflows, the error is caught, and the program goes on
let turns = 0;
let limit = 0;
function jumps(n: number): number {
  turns++;
  return comesBack(n);
}
function comesBack(n: number): number {
  if (limit && n >= limit) return n;
  return jumps(n + 1) + 1;
}
function deed() {
  turns = 0;
  try {
    return String(jumps(0));
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
limit = 5;
console.log(deed());
