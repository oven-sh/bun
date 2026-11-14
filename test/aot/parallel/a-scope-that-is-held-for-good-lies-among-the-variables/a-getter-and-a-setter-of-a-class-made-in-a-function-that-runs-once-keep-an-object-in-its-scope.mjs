function program() {
  let last = null, reads = 0, log = [];
  class Cell { constructor(held) { this.held = held; } get value() { last = this; reads++; return this.held; } set value(next) { log.push(this.held); this.held = next; last = null; } touch() { return last === this ? 1 : 0; } }
  const cells = [new Cell(5), new Cell(7)];
  return (turn) => { const cell = cells[turn & 1]; let sum = cell.value + cell.touch(); cell.value = sum % 11; return sum + reads + log.length + (last === null ? 100 : 0); };
}
const step = program();
let sum = 0;
for (let turn = 0; turn < Number(process.argv[2] ?? "9"); turn++) sum = (sum * 31 + step(turn)) % 1000003;
console.log(sum);
