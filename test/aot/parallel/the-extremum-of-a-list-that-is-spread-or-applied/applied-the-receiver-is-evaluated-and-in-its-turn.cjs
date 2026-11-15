// Math.max | Math.min of a list that is spread or applied: every use of the result, and the order in which the operands are evaluated.
'use strict';
const out = [];
const log = [];
function say(word, value) { log.push(word); return value; }
for (let round = 0; round < 3; round++) {
  out.push(String(Math.max.apply(say('receiver', null), say('list', [1, 9, 4]))));
  out.push(String(Math.min.apply(say('receiver', { a: 1 }), say('list', [1.5, 9.5]))));
  out.push(String(Math.max.apply(say('receiver', 5), say('list', 'ab'.length > 5 ? [1] : null))));
  out.push(String(Math.max.apply(Math)));
  out.push(String(Math.max.apply(null, [1, 2], 3)));
  out.push(String(Math.max.call(null, 1, 7)));
}
out.push(log.join());
console.log(out.join('\n'));
