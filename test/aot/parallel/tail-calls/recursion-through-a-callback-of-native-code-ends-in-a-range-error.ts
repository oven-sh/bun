// a small function hands itself to `replace`, which calls it, without end: the stack overflows, the error is caught, and the program goes on
let turns = 0;
let limit = 0;
function again(): string {
  turns++;
  if (limit && turns >= limit) return "z";
  return "x".replace("x", again) + "y";
}
function deed() {
  turns = 0;
  try {
    return again();
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
limit = 5;
console.log(deed());
