
class Counter {
  value: any;
  step: any;
  constructor(value: any, step: any) { this.value = value; this.step = step; }
  next() { this.value = this.value + this.step; return this.value; }
}
const c = new Counter(Number(process.argv[2] ?? 1), 2);
let sum = 0;
for (let i = 0; i < 10; i++) sum += c.next();
console.log(sum);
