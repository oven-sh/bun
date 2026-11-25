// A list born with room, filled by its loop, then changed by the methods that move, cut and add values, frozen, given a name, and made sparse.
"use strict";
const first = JSON.parse('"x"');
function make(n) { const list = [first]; for (let i = 0; i < n; i++) list.push(i); return list; }
for (let n = 0; n <= 15; n += n < 3 ? 3 : n < 10 ? 7 : n < 11 ? 1 : 4) {
  const told = [];
  let l = make(n); told.push(l.pop(), l.shift(), l.length);
  l = make(n); l.unshift("u", "v"); told.push(l.join());
  l = make(n); told.push(l.splice(1, 2, "p", "q", "r").join(), l.join());
  l = make(n); told.push(l.reverse().join(), l.sort().join());
  l = make(n); told.push(l.concat(make(2)).join(), l.slice(1, 4).join(), [...l, ...l].length);
  l = make(n); l.length = 0; l.push(1); told.push(l.join(), l.length);
  l = make(n); l.fill(7, 1); told.push(l.join());
  l = make(n); l.copyWithin(0, 1); told.push(l.join());
  l = make(n); l.name = "n"; l[100] = 1; told.push(l.length, Object.keys(l).length, l.name);
  l = make(n); Object.freeze(l); try { l.push(1); } catch (error) { told.push(error.constructor.name); }
  l = make(n); delete l[0]; told.push(0 in l, l.length, l.flat().length);
  console.log(n, told.join(" | "));
}
