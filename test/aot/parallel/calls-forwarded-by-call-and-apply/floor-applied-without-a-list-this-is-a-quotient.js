// floor-applied-without-a-list-this-is-a-quotient: what is written first in the call is not the function's first argument.
const unseen = (0, eval)("(x) => x");
const show = (it) => typeof it === 'bigint' ? it + 'n' : typeof it === 'object' && it !== null ? JSON.stringify(it) : Object.is(it, -0) ? '-0' : String(it);
function asked(count) {
  const whole = count | 0;
  return Math.floor.apply(whole / 2);
}
let answer;
for (let turn = 0; turn < 300; turn++) answer = asked(unseen(7));
console.log(show(answer));
