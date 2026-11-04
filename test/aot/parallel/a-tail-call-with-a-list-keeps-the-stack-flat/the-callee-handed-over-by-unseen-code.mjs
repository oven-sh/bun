const same = (0, eval)("(x) => x");
let last = null;
function step(n, hole, acc) {
  if (n === 0) return acc + (hole === undefined ? 0 : 1000);
  const list = [n - 1, , acc + 1];
  last = list;
  return next.apply(null, list);
}
const next = same(step);
let answer;
try { answer = String(step(1000000, undefined, 0)); } catch (error) { answer = error.constructor.name; }
console.log(answer, last.length);
