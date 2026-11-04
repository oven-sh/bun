let last = null;
let reads = 0;
function step(n, computed, acc) {
  if (n === 0) return acc + computed;
  const list = [n - 1, 0, acc + 1];
  Object.defineProperty(list, 1, { get() { reads++; return 5; } });
  last = list;
  return step.apply(null, list);
}
let answer;
try { answer = String(step(200000, 5, 0)); } catch (error) { answer = error.constructor.name; }
console.log(answer, last.length, reads);
