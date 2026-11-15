'use strict';
class Tally { static next = 1; }
function sum(rounds) { let s = 0; for (let i = 0; i < rounds; i++) s += Tally.next; return s; }
const seen = [sum(5)];
for (const value of ['seven', 2.5, null, true, 4n, 4]) {
  Reflect.set(Tally, 'next', value);
  let said;
  try { said = String(sum(3)); } catch (error) { said = error.constructor.name; }
  seen.push(said);
}
console.log(seen.join('|'));
