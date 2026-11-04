const parent = Object.create(Array.prototype);
parent[1] = 4;
let last = null;
function step(n, inherited, acc) {
  if (n === 0) return acc + inherited;
  const list = [n - 1, , acc + 1];
  Object.setPrototypeOf(list, parent);
  last = list;
  return step.apply(null, list);
}
let answer;
try { answer = String(step(300000, 4, 0)); } catch (error) { answer = error.constructor.name; }
console.log(answer, last.length, 1 in last, Object.hasOwn(last, 1));
