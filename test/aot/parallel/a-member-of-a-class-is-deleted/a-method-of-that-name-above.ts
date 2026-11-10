// a member of a class whose methods are called by name is deleted: a method of that name above
class Counter {
  label: string = "c";
  pick?: (n: number) => number = n => n + 1;
  step(by: number): number {
    return this.pick!(by);
  }
}
(Counter.prototype as unknown as { pick(n: number): number }).pick = function (n: number) {
  return n * 100;
};
const counter = new Counter();
let total = 0;
for (let i = 0; i < 300; i++) total = (total + counter.step(i & 7)) | 0;
delete counter.pick;
console.log(total, counter.step(3), counter.pick!(4), Object.keys(counter).join());
