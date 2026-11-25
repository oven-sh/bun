// a member of a class whose methods are called by name is deleted: stored again comes last in the order
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
spare.count = 7;
let seen = "";
for (const key in spare) seen += key + ";";
console.log(run(new Counter()), Object.keys(spare).join(), seen, JSON.stringify(spare), JSON.stringify({ ...spare }));
