// Object.create() of a literal that holds a method and a getter, and a store of a field, beside a class that says the same. A turn with the one may cost a few times what a turn with the other costs, not five times.
const above = {
  get() {
    return this.x;
  },
  get twice() {
    return this.x * 2;
  },
};
function create(x) {
  const created = Object.create(above);
  created.x = x;
  return created;
}
class Declared {
  constructor(x) {
    this.x = x;
  }
  get() {
    return this.x;
  }
  get twice() {
    return this.x * 2;
  }
}
const created = create(1),
  declared = new Declared(1);
let sums = 0;
function fastestOf(runs, loop) {
  let fastest = Infinity;
  for (let run = 0; run < runs; run++) {
    const began = performance.now();
    loop();
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
}
const ofTheClass = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + declared.get() + declared.twice + i) | 0;
  sums = (sums + sum) | 0;
});
const ofTheLiteral = fastestOf(5, () => {
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum = (sum + created.get() + created.twice + i) | 0;
  sums = (sums + sum) | 0;
});
console.log(sums, Object.keys(created).join(), Object.getPrototypeOf(created) === above);
console.log(ofTheLiteral < ofTheClass * 5 ? "under five times the time" : "over five times the time");
