// `Object.create(above)` at two places: what the two places make is of one layout, and a getter and a method are found through the heirs without a look by name.
const above = {
  get one() {
    return this.b + 1;
  },
  two() {
    return this.b + 2;
  },
};
const first = Object.create(above),
  second = Object.create(above);
first.b = 1;
second.b = 2;
const units = 1000;
let sum = 0;
for (let unit = 0; unit < units; unit++) {
  const heir = unit & 1 ? second : first;
  sum += heir.one + heir.two();
}
console.log(sum > 0 ? "ok" : "no");
