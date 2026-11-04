function step(n, hole, acc) {
  if (n === 0) return acc + (hole === undefined ? 0 : 1000);
  return step.apply(null, { length: 3, 0: n - 1, 2: acc + 1 });
}
let answer;
try { answer = String(step(1000000, undefined, 0)); } catch (error) { answer = error.constructor.name; }
console.log(answer);
