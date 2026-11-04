let last = null;
function step(n) {
  const acc = arguments[69];
  if (n < 1) return acc + (arguments[35] === undefined ? 0 : 1000) + arguments[1] + arguments.length;
  const list = [n - 1, 0.5];
  list[69] = acc + 0.25;
  last = list;
  return step.apply(null, list);
}
const first = [300000.5, 0.5];
first[69] = 0.5;
let answer;
try { answer = String(step.apply(null, first)); } catch (error) { answer = error.constructor.name; }
console.log(answer, last.length, 35 in last);
