class Counter {
  count = 0;
  other = 0;
}
class Past32Bits {
  count = 4294967290;
}
function readsThenSteps(counter, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += counter.count;
    counter.count--;
  }
  return sum;
}
function stepsThenReadsOnALaterTurn(counter, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    if (counter.count < 16) counter.count++;
    else counter.other++;
    sum += counter.count;
    counter.count--;
  }
  return sum;
}
function stepsAlone(counter, turns) {
  for (let i = 0; i < turns; i++) counter.count--;
}
function readsThenStepsUp(counter, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += counter.count;
    counter.count++;
  }
  return sum;
}
const counter = new Counter();
const turns = process.argv.length * 1000;
console.log(readsThenSteps(counter, turns), stepsThenReadsOnALaterTurn(counter, turns));
stepsAlone(counter, turns);
console.log(counter.count, counter.other);
const past = new Past32Bits();
console.log(readsThenStepsUp(past, 20), past.count);
stepsAlone(past, 20);
console.log(past.count);
