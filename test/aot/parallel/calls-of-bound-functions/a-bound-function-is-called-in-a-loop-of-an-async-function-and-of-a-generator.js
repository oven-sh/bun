function add(a, b) { return a + b; }
class Scale { constructor(factor) { this.factor = factor; } times(value, more) { return value * this.factor + more; } }
async function total(rounds) {
  const scale = new Scale(3);
  const inc = add.bind(null, 1), times = scale.times.bind(scale), timesTwo = scale.times.bind(scale, 2);
  let sum = 0;
  for (let round = 0; round < rounds; round++) { sum += inc(round) + times(round, 1) + timesTwo(round); if ((round & 7) === 0) await null; }
  return sum;
}
function* steps(rounds) {
  const inc = add.bind(null, 10);
  for (let round = 0; round < rounds; round++) yield inc(round);
}
let seen = 0; for (const step of steps(20)) seen += step;
total(40).then(sum => console.log(sum, seen));
