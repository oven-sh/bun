// STATISTIC: DefaultedElementsReadInIterations >= 1
// values[i] || 0 and values[i] ?? 0 behind the end of an array: the specialized iteration goes on.
class Polynomial {
  constructor(coefficients) {
    this.c = coefficients;
  }
  add(other) {
    const n = Math.max(this.c.length, other.c.length);
    const result = [];
    for (let i = 0; i < n; i++)
      result.push((this.c[i] || 0) + (other.c[i] ?? 0));
    return new Polynomial(result);
  }
}
const p = new Polynomial([1, 2.5, 3]), q = new Polynomial([0.5, 1, 2, 4, 0.25]);
for (let i = 0; i < 20; i++) {
  const sum = p.add(q);
  if (sum.c.join() !== "1.5,3.5,5,4,0.25" || q.add(p).c.join() !== "1.5,3.5,5,4,0.25")
    throw new Error("wrong sum: " + sum.c.join());
}
console.log(p.add(p).c.join(), q.add(new Polynomial([])).c.join(), p.add(new Polynomial([-1, -2.5, -3, -0])).c.map(x => Object.is(x, -0)).join());
