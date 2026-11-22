// a member of a class whose methods are called by name is deleted: then in and has own
// STATISTIC: AccessesUnknown <= 2
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
const spare = new Counter();
delete spare.count;
console.log(run(new Counter()), "count" in spare, Object.hasOwn(spare, "count"), spare.count, "label" in spare);
