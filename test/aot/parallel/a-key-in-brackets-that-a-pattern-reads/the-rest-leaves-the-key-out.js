// What the rest copies leaves out the key that was read under the constant, and keys are read in the order in which they are written.
const FIRST = "first";
const seen = [];
const source = {
  get first() {
    seen.push("first");
    return 1;
  },
  get second() {
    seen.push("second");
    return 2;
  },
  third: 3,
};
const { second, [FIRST]: one, ...others } = source;
console.log(one, second, JSON.stringify(others), seen.join());
