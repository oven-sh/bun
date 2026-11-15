// a member of a class whose methods are called by name is deleted: a sealed object
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
const spare = Object.seal(new Counter());
let said = "";
try {
  delete spare.count;
  said = "deleted";
} catch (error) {
  said = (error as Error).constructor.name;
}
spare.count = 4;
console.log(run(new Counter()), said, spare.count, Object.keys(spare).join());
