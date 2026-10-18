// reads an own property whose name is a getter's name elsewhere in the program
const operations = 100;
class Meter {
  ticks: number;
  constructor(ticks: number) {
    this.ticks = ticks;
  }
  get reading(): number {
    return this.ticks * 2;
  }
}
function record(reading: number): any {
  return { reading, unit: "kWh" };
}
const records = [record(1), record(2), record(3), record(4)];
let total = new Meter(1).reading;

kernel: {
  let sum = 0;
  for (let i = 0; i < operations; i++) sum += records[i & 3].reading;
  total += sum;
}

console.log(total);
