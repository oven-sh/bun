// a member of a class whose methods are called by name is deleted: by a key made at run time
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
const spare = new Counter() as Counter & Record<string, unknown>;
const key = ["co", "unt"].join("");
delete spare[key];
console.log(run(new Counter()), spare.count, Object.keys(spare).join(), spare.step(2));
