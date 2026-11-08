let last = null;
function step(n, hole, acc) {
  if (n === 0) return acc;
  const list = [n - 1, , acc + 1];
  last = list;
  return step.apply(null, list);
}
let answer;
try { answer = String(step(1000000, undefined, 0)); } catch (error) { answer = error.constructor.name; }
console.log(answer, last.length);
