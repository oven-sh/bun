'use strict';
const rows = JSON.parse('[{"x":1,"y":2},null,{"x":3},0,{"y":4,"x":5},"",{"x":"six","y":[7]}]');
function Point(row) { var given = row || {}; this.x = given.x; this.y = given.y; }
function Named(row) { const given = row ?? { x: 'none', y: 'none' }; this.x = given.x; this.y = given.y; }
function each(from) {
  let said = '';
  for (let i = 0; i < rows.length; i++) { const point = new Point(rows[i]), named = new Named(rows[i]); said += point.x + ',' + point.y + ',' + named.x + ',' + named.y + ';'; }
  return said + from;
}
globalThis.kept = each;
for (let turn = 0; turn < 3; turn++) console.log(each(turn));
