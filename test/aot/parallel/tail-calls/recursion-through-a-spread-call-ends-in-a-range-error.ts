// a small function calls itself with its rest spread out without end: the stack overflows, the error is caught, and the program goes on
let turns = 0;
let limit = 0;
function spread(...values: number[]): number {
  turns++;
  if (limit && turns >= limit) return values.length;
  return spread(...values) + 1;
}
function deed() {
  turns = 0;
  try {
    return String(spread(1, 2, 3));
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
limit = 5;
console.log(deed());
