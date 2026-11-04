let holes = 0;
function even(n, hole, acc) {
  if (hole === undefined) holes++;
  if (n === 0) return acc;
  return odd.apply(null, [n - 1, , acc + 1]);
}
function odd(n, hole, acc) {
  if (hole === undefined) holes++;
  if (n === 0) return -acc;
  const list = new Array(3);
  list[2] = acc + 1;
  list[0] = n - 1;
  return even.apply(null, list);
}
let answer;
try { answer = String(even(1000000, undefined, 0)); } catch (error) { answer = error.constructor.name; }
console.log(answer, holes);
