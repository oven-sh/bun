const walker = {
  last: null,
  step(n, hole, acc) {
    if (n === 0) return acc + (hole === undefined ? 0 : 1000);
    const inner = (list) => { this.last = list; return this.step.apply(this, list); };
    return inner([n - 1, , acc + 1]);
  },
};
let answer;
try { answer = String(walker.step(1000000, undefined, 0)); } catch (error) { answer = error.constructor.name; }
console.log(answer, walker.last.length);
