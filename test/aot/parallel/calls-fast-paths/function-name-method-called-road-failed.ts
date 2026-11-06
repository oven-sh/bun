// Some objects of a class have a function of their own under the name of a method of the class. Every call takes the function of the object where it has one, and the method where it has none.
// Flags: --aot-testing=FailPredictions:2:1
class Walker {
  total = 0;
  walk(by: number): void {
    this.step(by);
  }
  step(by: number): void {
    this.total += by;
  }
}
class Doubling extends Walker {
  constructor(twice: boolean) {
    super();
    if (twice)
      this.step = function (this: Doubling, by: number) {
        this.total += by * 2;
      };
  }
}
function stepEach(walkers: Walker[]): void {
  for (const walker of walkers) walker.step(1);
}
const describe = (walkers: Walker[]) =>
  walkers.map(walker => walker.total + ":" + Object.keys(walker).join()).join(" ");

const walkers: Walker[] = [new Walker(), new Doubling(false), new Doubling(true)];
for (let turn = 0; turn < 30_000; turn++) walkers[turn % 3].walk(1);
console.log(describe(walkers));
for (let turn = 0; turn < 10_000; turn++) stepEach(walkers);
console.log(describe(walkers));
export {};
