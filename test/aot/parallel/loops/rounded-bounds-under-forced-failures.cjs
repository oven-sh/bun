// Under: --aot-testing=FailSpeculations --aot-check=Validate: the drawn failure was between the branch on the test of a rounded bound and the narrowed bound: the walk stopped at "a Narrowed does not stand behind a branch on its test"
globalThis.sum = 1.5;
globalThis.mixed = 70;
globalThis.factor = 3;
const state = { count: 2, last: 2147483647 };
function compute(a, given) {
  let hits = 0;
  let i = 3;
  do {
    if (+sum < mixed >>> state.count) mixed = Math.imul(i, factor);
    if (given[i & 3] < state.count) break;
    hits++;
  } while (--i > 0);
  return hits + " " + mixed;
}
const answers = [];
for (const bound of [1.5, 0, -1, 2147483647, 2147483648, NaN, Infinity, "2", undefined]) {
  sum = bound;
  mixed = 70;
  answers.push(compute(1, [3, 1, 2, 5]), compute(NaN, [3, 4, 5, 6]));
}
console.log(answers.join("|"));
