// a small function hands itself to `map`, which calls it, without end: the stack overflows, the error is caught, and the program goes on
let turns = 0;
let limit = 0;
function each(n: number): number {
  turns++;
  if (limit && n >= limit) return n;
  return [n + 1].map(each)[0] + 1;
}
function deed() {
  turns = 0;
  try {
    return String(each(0));
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
limit = 5;
console.log(deed());
