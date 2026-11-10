// STATISTIC: WalkLoopsVersioned >= 0
'use strict';
const shelf = new Map();
function f(t) { let s = t & 1; for (let i = 0; i < shelf.get('rows').length; i++) s = s + shelf.get('rows')[i]; return s; }
function g(t, other) { let s = ''; for (let i = 0; i < shelf.get('rows').length; i++) { s = s + shelf.get('rows')[i]; if (i === t) shelf.set('rows', other); } return s; }
const said = [];
for (const text of ['[1,2,3]', '[1.5,2.5]', '["a","b"]', '{"length":3,"0":4,"1":5,"2":6}', '"text"', '[]', '[1,null,3]', '[[1],[2]]']) {
  shelf.set('rows', JSON.parse(text));
  for (let t = 0; t < 3; t++) said.push(f(t));
}
for (const [first, second] of [['[1,2,3,4]', '[9.5,8.5,7.5,6.5,5.5]'], ['[1,2,3,4]', '"wxyz!"'], ['[1,2,3,4]', '{"length":2,"0":7,"1":8}'], ['"abcd"', '[1,2,3,4,5,6]'], ['[1,2,3,4]', '[]']]) {
  for (let t = 0; t < 3; t++) {
    shelf.set('rows', JSON.parse(first));
    said.push(g(t, JSON.parse(second)));
  }
}
shelf.set('rows', undefined);
try { f(0); } catch (error) { said.push(error.constructor.name); }
console.log(said.join(' '));
