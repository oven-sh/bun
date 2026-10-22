// A class that is evaluated twice, so that `instanceof` is answered under tests, and values that are instances of it or undefined.
function makeCounter(step) {
  return class Counter {
    n = 0;
    bump() {
      return (this.n += step);
    }
  };
}
const ByOne = makeCounter(1);
const ByTen = makeCounter(10);
const all = [new ByOne(), new ByTen(), new ByOne()];

const isByOne = counter => counter instanceof ByOne;
const isByTen = counter => counter instanceof ByTen;

console.log(all.map(isByOne).join(), all.map(isByTen).join());
console.log(isByOne(all[0]), isByOne(all[1]), isByOne(all[7]), isByTen(all[7]));

let instances = 0;
for (let index = 0; index < 6; index++) {
  if (isByOne(all[index])) instances += 1;
  if (isByTen(all[index])) instances += 10;
}
console.log(instances);

const found = all.find(counter => counter.n > 5);
console.log(found instanceof ByOne, found instanceof ByTen, all.at(-1) instanceof ByOne, all.at(9) instanceof ByOne);
