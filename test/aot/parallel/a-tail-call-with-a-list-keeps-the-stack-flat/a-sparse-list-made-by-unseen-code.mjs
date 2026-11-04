const make = (0, eval)("(first, third) => { const list = [first]; list[200000] = 0; list.length = 3; list[2] = third; return list; }");
function step(n, hole, acc) {
  if (n === 0) return acc + (hole === undefined ? 0 : 1000);
  return step.apply(null, make(n - 1, acc + 1));
}
let answer;
try { answer = String(step(200000, undefined, 0)); } catch (error) { answer = error.constructor.name; }
console.log(answer);
