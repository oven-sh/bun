let last = null;
function step(n, computed, acc) {
  if (n === 0) return String(acc) + ":" + String(computed) + ":" + arguments.length;
  const list = [n - 1, 0, 7];
  Object.defineProperty(list, 1, { get() { list.length = 2; return (acc ?? 0) + 1; } });
  last = list;
  return step.apply(null, list);
}
let answer;
try { answer = step(200000, 0, 0); } catch (error) { answer = error.constructor.name; }
console.log(answer, last.length);
