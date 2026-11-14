// || and ?? tell apart what an element holds: 0, -0, NaN, a hole, undefined, null, "", false, and what a prototype holds.
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v));
function either(values, n) {
  const result = [];
  for (let i = 0; i < n; i++)
    result.push(values[i] || -0);
  return result;
}
function present(values, n) {
  const result = [];
  for (let i = 0; i < n; i++)
    result.push(values[i] ?? 7.5);
  return result;
}
function sums(values, other, n) {
  let sum = 0;
  for (let i = 0; i < n; i++)
    sum = sum * 0.5 + (values[i] || 0.25) * (other[i + 1] ?? 2);
  return sum;
}
function counts(values, n) {
  const made = [];
  for (let i = 0; i < n; i++)
    made[values[i % values.length] & 3] = (made[values[i % values.length] & 3] || 0) + 1;
  return made;
}
const arrays = [[0.5, 1.5, 2.5], [1, 2, 3], [0, -0, 0.5], [1, , 3], [0.5, , , 2], [], [NaN, 1, 0.5], [null, undefined, 1], ["", "a", 1.5], [false, true, 0], [0n, 1n], new Float64Array([0, NaN, 2.5]), Object.assign([1, 2], { 4: 8 }), Object.setPrototypeOf([1, , 3], { 1: 4.5, 3: 6 })];
for (const values of arrays) {
  for (const n of [2, 3, 5, 9]) {
    for (const run of [() => either(values, n), () => present(values, n), () => [sums(values, [0.5, 1, 1.5], n)], () => [sums([1, 2, 3], values, n)], () => (values.length ? counts(values, n) : [])]) {
      try {
        console.log(Array.from(run(), show).join(" "));
      } catch (error) {
        console.log(error.constructor.name);
      }
    }
  }
}
