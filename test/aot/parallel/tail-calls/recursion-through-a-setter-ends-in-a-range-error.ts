// a small setter stores into itself without end: the stack overflows, the error is caught, and the program goes on
let turns = 0;
class Cell {
  last = 0;
  limit = 0;
  set value(v: number) {
    turns++;
    this.last = v;
    if (this.limit && v >= this.limit) return;
    this.value = v + 1;
  }
}
const cell = new Cell();
function deed() {
  turns = 0;
  try {
    cell.value = 0;
    return String(cell.last);
  } catch (e) {
    return (e as Error).name + " " + (turns > 100);
  }
}
console.log(deed());
for (let i = 0; i < 3; i++) console.log(deed());
cell.limit = 5;
console.log(deed());
