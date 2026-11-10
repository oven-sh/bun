// An accessor and a private field for each object.
// Sizes: 250 1000 4000
// Passes: 3100
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
class Meter {
  #count = 0;
  get count(): number {
    return this.#count;
  }
  set count(value: number) {
    this.#count = value & 1023;
  }
  bump(): number {
    return ++this.#count;
  }
}
function use(meter: Meter, i: number): number {
  meter.count = i;
  return meter.bump() + meter.count;
}
function once(): string {
  const meters: Meter[] = [];
  for (let i = 0; i < size * 3; i++) meters.push(new Meter());
  let sum = 0;
  for (let i = 0; i < meters.length; i++) sum += use(meters[i]!, i);
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
