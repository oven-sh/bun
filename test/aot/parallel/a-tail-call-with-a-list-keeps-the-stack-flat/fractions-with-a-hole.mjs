let last = null;
function step(n, hole, acc) {
  if (n < 1) return acc + (hole === undefined ? 0 : 1000);
  const list = [n - 1, , acc + 0.25];
  last = list;
  return step.apply(null, list);
}
let answer;
try { answer = String(step(1000000.5, undefined, 0.5)); } catch (error) { answer = error.constructor.name; }
console.log(answer, last.length, 1 in last);
