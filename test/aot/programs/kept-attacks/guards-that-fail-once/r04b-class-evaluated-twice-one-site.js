// Guards that fail once: class evaluated twice one site. It prints what plain Bun prints.
const trip = process.argv[2] === "trip";
const N = Number(process.argv[3] ?? 10000000);
const variant = process.argv[4] ?? "loop";

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
const made = [];
if (variant === "loop") for (let k = 0; k < (trip ? 2 : 1); k++) made.push(makeCounter());
const Counter = made[0];

function run(counter) {
  let sum = 0;
  for (let i = 0; i < N; i++) sum = (sum + counter.add(i & 7)) | 0;
  return sum;
}
console.log(run(new Counter(1)));
