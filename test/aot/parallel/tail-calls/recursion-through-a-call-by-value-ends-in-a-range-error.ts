// a small function calls whatever it is handed, which is itself, without end: the stack overflows, the error is caught, and the program goes on
let turns = 0;
function climb(next: (f: any, n: number) => number, n: number): number {
  turns++;
  return next(next, n + 1) + 1;
}
const held: { f: any } = { f: climb };
function deed() {
  turns = 0;
  try {
    return String(climb(held.f, 0));
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
held.f = (f: any, n: number) => n;
console.log(deed());
