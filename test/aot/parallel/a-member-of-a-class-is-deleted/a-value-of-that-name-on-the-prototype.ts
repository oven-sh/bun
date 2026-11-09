// a member of a class whose methods are called by name is deleted: a value of that name on the prototype
class Counter {
  count?: number = 0;
  label: string = "c";
  step(by: number): number {
    this.count = (this.count ?? 0) + by;
    return this.count;
  }
}
function run(counter: Counter): number {
  let total = 0;
  for (let i = 0; i < 300; i++) total = (total + counter.step(i & 7)) | 0;
  return total;
}
(Counter.prototype as { count?: number }).count = 1000;
const spare = new Counter();
delete spare.count;
console.log(run(new Counter()), spare.count, "count" in spare, Object.hasOwn(spare, "count"), spare.step(1), Object.hasOwn(spare, "count"));
