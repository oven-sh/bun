let turns = 0;
let counted = -1;
function step(first, second, third) {
  counted = arguments.length;
  if (++turns === 1000000) return String(first) + String(second) + String(third);
  return step.apply(null, new Array(3));
}
let answer;
try { answer = step(1, 2, 3); } catch (error) { answer = error.constructor.name; }
console.log(answer, turns, counted);
