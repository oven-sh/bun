let last = null;
function step(n, hole, acc) {
  if (n === 0) return acc + (hole === undefined ? 0 : 1000);
  const list = [n - 1];
  list[200000] = 0;
  list.length = 3;
  list[2] = acc + 1;
  last = list;
  return step.apply(null, list);
}
let answer;
try { answer = String(step(200000, undefined, 0)); } catch (error) { answer = error.constructor.name; }
console.log(answer, last.length, 1 in last);
