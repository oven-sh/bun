class Passing {
  constructor(target) {
    return target;
  }
}
class Leveled extends Passing {
  level = 7;
  constructor(target) {
    super(target);
  }
}
function makeGauge(kept) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return { kept: kept + work - 1, set level(value) { this.kept = value; } };
}
function store(gauge) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  gauge.level = 49 + work;
  return gauge.kept;
}
function turn(round) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const gauge = makeGauge(3);
  new Leveled(gauge);
  return store(gauge) * 1000 + gauge.level + work - 1;
}
let sum = 0;
for (let round = 0; round < 200; round++) sum = (sum + turn(round)) | 0;
console.log(sum);
console.log(turn(1));
