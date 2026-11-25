// a member of a class whose methods are called by name is deleted: a subclass
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
class Named extends Counter {
  name: string = "n";
  twice(by: number): number {
    return this.step(by) + this.step(by);
  }
}
const spare = new Named();
delete spare.count;
const named = new Named();
let total = 0;
for (let i = 0; i < 300; i++) total = (total + named.twice(i & 3)) | 0;
console.log(run(new Counter()), total, spare.count, Object.keys(spare).join(), spare.twice(2), Object.keys(spare).join());
