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
function makeGauge(id) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return { id: id + work, get level() { return 1; } };
}
function readLevel(gauge) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return gauge.level + work - 1;
}
function turn(round) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const gauge = makeGauge(round);
  const before = readLevel(gauge);
  new Leveled(gauge);
  return before * 100 + readLevel(gauge) + work - 1;
}
let sum = 0;
for (let round = 0; round < 200; round++) sum = (sum + turn(round)) | 0;
console.log(sum);
console.log(turn(1));
console.log(new Leveled({ north: 1 }).level);
