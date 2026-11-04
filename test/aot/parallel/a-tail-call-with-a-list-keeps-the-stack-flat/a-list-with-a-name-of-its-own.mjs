let last = null;
function step(n, middle, acc) {
  if (n === 0) return acc + middle;
  const list = [n - 1, 3, acc + 1];
  list.label = "row";
  last = list;
  return step.apply(null, list);
}
let answer;
try { answer = String(step(1000000, 3, 0)); } catch (error) { answer = error.constructor.name; }
console.log(answer, last.length, last.label);
