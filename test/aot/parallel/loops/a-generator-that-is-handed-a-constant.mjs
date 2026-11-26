// A generator is made of a text or a number and stepped to its end by another function. Its steps read a method off what it was handed.
const last = steps => {
  for (;;) {
    const step = steps.next(0);
    if (step.done) return step.value;
  }
};
class Tower {
  climb(steps) {
    return steps + 21;
  }
}
class Mast {
  climb(steps) {
    return steps * 2;
  }
}
function* tries(place, rounds) {
  let seen = 0;
  for (let round = 0; round < rounds; round++) {
    if (place.climb) seen += place.climb(round);
  }
  return seen;
}
const tried = (place, rounds) => last(tries(place, rounds));
let all = 0;
for (let turn = 0; turn < 20; turn++) all += tried("x", 2) + tried(7, 2);
console.log(all, tried(new Tower(), 3), tried(new Mast(), 2));
