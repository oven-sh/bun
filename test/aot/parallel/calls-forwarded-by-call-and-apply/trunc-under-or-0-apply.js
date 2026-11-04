// trunc-under-or-0-apply: what is written first in the call is not the function's first argument.
const unseen = (0, eval)("(x) => x");
const show = (it) => typeof it === 'bigint' ? it + 'n' : typeof it === 'object' && it !== null ? JSON.stringify(it) : Object.is(it, -0) ? '-0' : String(it);
function asked(amount) {
  const number = +amount;
  return Math.trunc.apply(7, [number]) | 0;
}
let answer;
for (let turn = 0; turn < 300; turn++) answer = asked(unseen(12.75));
console.log(show(answer));
