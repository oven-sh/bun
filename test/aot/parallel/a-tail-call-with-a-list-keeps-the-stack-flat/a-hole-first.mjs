let last = null;
function step(hole, n, acc) {
  if (n === 0) return acc + (hole === undefined ? 0 : 1000);
  const list = [, n - 1, acc + 1];
  last = list;
  return step.apply(null, list);
}
let answer;
try { answer = String(step(undefined, 1000000, 0)); } catch (error) { answer = error.constructor.name; }
console.log(answer, last.length, 0 in last);
