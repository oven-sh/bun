// Flags: --aot-limit=MaxWarmCodeValues:1
// A copy of a list by spread holds a NaN; the loop that sums the copy stores a fraction through it.
const holder = { defaults: [1, 2, NaN, 4, 5, 6], work() {
  const copy = [...this.defaults];
  let s = 0;
  for (let i = 0; i < copy.length && i < 6; i++) {
    s += copy[i];
    if (copy[i] > 2 && i < 4) copy[i + 1] = 5.5;
  }
  return s + "";
} };
console.log(holder.work());
