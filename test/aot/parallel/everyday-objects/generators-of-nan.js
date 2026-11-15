// Generators of fractions that yield NaN, stepped by hand and by loops
function* ratios(list) {
  for (let i = 0; i < list.length; i++) yield list[i] / list[(i + 1) % list.length];
}
function step(list) {
  const out = [];
  const iterator = ratios(list);
  for (let i = 0; i < 6; i++) {
    const { done, value } = iterator.next();
    if (done) break;
    out.push(value);
  }
  let sum = 0;
  for (const value of ratios(list)) if (value === value) sum += value;
  return out.join() + " " + sum;
}
console.log(step([1.5, 0.5, 2.5]));
console.log(step([0, 0, 1.25]));
console.log(step([0.25, 0, 0, 0]));
