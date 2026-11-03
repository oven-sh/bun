// (sum + f(i)) | 0 and (sum + await f(i)) | 0 take the low word of the sum whatever comes back: a whole number of any size, a fraction, -0, NaN, an infinity, a string.
const lists = [
  [1, 2, 3, 4, 5],
  [0.5, 1.5, -2.25, 1e-9],
  [2147483647, 1, 2147483647, 2],
  [-2147483648, -1, 4294967296, 4294967297.5],
  [1e21, -1e21, 9007199254740993, 3],
  [NaN, 1, Infinity, 2, -Infinity, 3, -0, 4],
  [1, "2", 3, null, 4, undefined, 5, true],
];
let calls = 0;
function pick(list, i) {
  calls++;
  if (calls % 1000 === 999) return list[i % list.length];
  try {
    return list[i % list.length];
  } finally {
    if (calls < 0) console.log(calls);
  }
}
function sumOfCalls(list, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + pick(list, i)) | 0;
  return sum;
}
function sumBesideCalls(list, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    pick(list, i);
    sum = (sum + list[i % list.length]) | 0;
  }
  return sum;
}
async function later(list, i) {
  return list[i % list.length];
}
async function sumOfAwaits(list, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + (await later(list, i))) | 0;
  return sum;
}
async function sumOfThenables(list, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = ((await { then: resolve => resolve(list[i % list.length]) }) + sum) | 0;
  return sum;
}
function* each(list, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + (yield i)) | 0;
  return sum;
}
function sumOfYields(list, n) {
  const steps = each(list, n);
  let step = steps.next();
  while (!step.done) step = steps.next(list[step.value % list.length]);
  return step.value;
}
for (const list of lists)
  for (const n of [list.length * 5 + 2, 37])
    console.log(sumOfCalls(list, n), sumBesideCalls(list, n), await sumOfAwaits(list, n), await sumOfThenables(list, n), sumOfYields(list, n));
console.log(calls);
