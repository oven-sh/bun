'use strict';
// A record of functions that other code holds too is read off a variable and its functions are called by name in loops; in the middle a function is replaced, deleted, redefined as a getter or made unwritable.
const held = [];
const keep = record => { held.push(record); return record; };
let steps = keep({ up: x => x + 1, down(x) { return x - 2; }, twice: function (x) { return x * 2 + (this === steps ? 0 : 100); } });
function walk(n, at, change) {
  let x = 3;
  for (let i = 0; i < n; i++) {
    if (i === at) change();
    x = steps.up(x);
    x = steps.twice(x) % 1000;
    x = steps.down(x);
  }
  return x;
}
const changes = {
  none() {},
  replaced() { held[0].up = x => x + 10; },
  deleted() { delete held[0].down; },
  getter() { Object.defineProperty(held[0], 'twice', { get() { return x => x * 3; }, configurable: true }); },
  fixed() { Object.defineProperty(held[0], 'up', { value: x => x - 1, writable: false, configurable: true }); },
  frozen() { Object.freeze(held[0]); held[0] = null; },
  number() { held[0].down = 7; },
  inherited() { delete held[0].up; Object.setPrototypeOf(held[0], { up: x => x + 5 }); },
  other() { steps = keep({ up: x => x, down: x => x, twice: x => x + 1 }); },
};
const fresh = () => { held.length = 0; steps = keep({ up: x => x + 1, down(x) { return x - 2; }, twice: function (x) { return x * 2 + (this === steps ? 0 : 100); } }); };
for (const name of Object.keys(changes)) for (const at of [-1, 0, 1, 37, 99]) {
  fresh();
  let said;
  try { said = walk(100, at, changes[name]); } catch (e) { said = e.constructor.name; }
  console.log(name, at, said);
}
