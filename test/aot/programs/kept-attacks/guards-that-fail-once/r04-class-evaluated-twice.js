// Guards that fail once: class evaluated twice. It prints what plain Bun prints.
const trip = process.argv[2] === "trip";
const N = Number(process.argv[3] ?? 10000000);

function makeCounter() {
  return class Counter {
    constructor(start) {
      this.value = start;
    }
    add(amount) {
      this.value = (this.value + amount) | 0;
      return this.value;
    }
  };
}
const Counter = makeCounter();
if (trip) makeCounter();

function run(counter) {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + counter.add(i & 7)) | 0;
  return sum;
}
console.log(run(new Counter(1)));
