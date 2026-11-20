let last = null;
function step(n) {
  const acc = arguments[69];
  if (n === 0) return acc + arguments[35] + arguments.length;
  const list = new Array(70).fill(2);
  list[0] = n - 1;
  list[69] = acc + 1;
  last = list;
  return step.apply(null, list);
}
const first = new Array(70).fill(2);
first[0] = 300000;
first[69] = 0;
let answer;
try { answer = String(step.apply(null, first)); } catch (error) { answer = error.constructor.name; }
console.log(answer, last.length, 35 in last);
