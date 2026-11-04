let last = null;
function step(n, hole, acc) {
  if (n === 0) return acc + (hole === undefined ? 0 : 1000);
  const list = [n - 1, , acc + 1];
  last = list;
  return step.apply(null, list);
}
let total = 0;
let answer;
try {
  for (let round = 0; round < 300; round++) total += step(30000, undefined, 0);
  answer = String(total);
} catch (error) { answer = error.constructor.name; }
console.log(answer, last.length);
