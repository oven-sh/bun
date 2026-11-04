// a small getter reads itself without end: the stack overflows, the error is caught, and the program goes on
let turns = 0;
class Well {
  floor = 0;
  get depth(): number {
    turns++;
    if (this.floor && turns >= this.floor) return 0;
    return this.depth + 1;
  }
}
const well = new Well();
function deed() {
  turns = 0;
  try {
    return String(well.depth);
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
well.floor = 5;
console.log(deed());
