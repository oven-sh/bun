class Passing {
  constructor(target) {
    return target;
  }
}
class Graded extends Passing {
  grade = 7;
  constructor(target) {
    super(target);
  }
}
function makeGauge(id) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return { id: id + work, get level() { return 1; } };
}
function turn(round) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  const gauge = makeGauge(round);
  new Graded(gauge);
  return gauge.level * 100 + gauge.grade + work - 1;
}
let sum = 0;
for (let round = 0; round < 200; round++) sum = (sum + turn(round)) | 0;
console.log(sum);
