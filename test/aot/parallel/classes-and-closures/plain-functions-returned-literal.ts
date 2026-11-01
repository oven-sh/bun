// A function returns a literal whose members are all plain functions. Its caller calls one of them. object-census.test.ts counts how many function objects the run makes, without inlining.
interface Operations {
  addOne(n: number): number;
  double(n: number): number;
  neverCalled(n: number): number;
  neverRead(): string;
}
function operations(): Operations {
  return {
    addOne: function (n) {
      return n + 1;
    },
    double: function (n) {
      return n * 2;
    },
    neverCalled: function (n) {
      return n - 1;
    },
    neverRead,
  };
  function neverRead() {
    return "never";
  }
}
// The object outlives the call, so it is a real object.
const ring: Operations[] = [];
function use(n: number): number {
  const made = operations();
  ring[n & 7] = made;
  return n % 2 ? made.addOne(n) : made.double(n);
}
let sum = 0;
for (let i = 0; i < 3000; i++) sum += use(i);
const kept = operations();
console.log(sum, ring.length, ring[3].addOne(1), ring[3] !== ring[4], kept.neverCalled(1), kept.neverRead(), kept.addOne === kept.addOne, kept.addOne !== operations().addOne, typeof new (kept.double as unknown as new (n: number) => object)(1));
