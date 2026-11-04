let reads = 0;
class Stop extends Error {}
function step(n, computed, acc) {
  const list = [n - 1, 0, acc + 1];
  Object.defineProperty(list, 1, { get() { if (++reads === 200000) throw new Stop("at " + acc); return 5; } });
  return step.apply(null, list);
}
let answer;
try { answer = String(step(1000000, 5, 0)); } catch (error) { answer = error.constructor.name + ": " + error.message; }
console.log(answer, reads);
