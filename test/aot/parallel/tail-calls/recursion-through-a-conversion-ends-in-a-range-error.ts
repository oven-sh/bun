// a small valueOf converts its own object to a number without end: the stack overflows, the error is caught, and the program goes on
let turns = 0;
let limit = 0;
const deep = {
  valueOf(): number {
    turns++;
    if (limit && turns >= limit) return 0;
    return +(deep as any) + 1;
  },
};
function deed() {
  turns = 0;
  try {
    return String(+(deep as any));
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
limit = 5;
console.log(deed());
