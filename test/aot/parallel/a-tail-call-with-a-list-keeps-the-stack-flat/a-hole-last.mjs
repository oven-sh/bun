let last = null;
let counted = 0;
function step(n, acc, hole) {
  counted = arguments.length;
  if (n === 0) return acc + (hole === undefined ? 0 : 1000);
  const list = [n - 1, acc + 1, ,];
  last = list;
  return step.apply(null, list);
}
let answer;
try { answer = String(step(1000000, 0, undefined)); } catch (error) { answer = error.constructor.name; }
console.log(answer, last.length, 2 in last, counted);
