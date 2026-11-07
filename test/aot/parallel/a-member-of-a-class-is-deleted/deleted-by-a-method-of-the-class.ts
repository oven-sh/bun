// a member of a class whose methods are called by name is deleted: deleted by a method of the class
// STATISTIC: AccessesUnknown <= 1
class Counter {
  count?: number = 0;
  label: string = "c";
  step(by: number): number {
    this.count = (this.count ?? 0) + by;
    return this.count;
  }
  reset(): boolean {
    return delete this.count;
  }
}
const counter = new Counter();
let total = 0;
for (let i = 0; i < 300; i++) {
  total = (total + counter.step(i & 7)) | 0;
  if ((i & 63) === 63) total += counter.reset() ? 1 : 0;
}
console.log(total, counter.count, Object.keys(counter).join());
