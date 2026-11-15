'use strict';
const make = i => ({ x: i + 0.5, y: i % 7, z: i * 3 });
const kept = make(1);
const rows = JSON.parse('[{"x":"4","y":"1","z":"2"},{"x":1,"y":null,"z":true},{"x":2},{"x":[3],"y":{"valueOf":1},"z":""},{"x":1e308,"y":1e308,"z":-1e308},{"x":-0,"y":-0,"z":0},{"x":0,"y":0,"z":0},{"x":1.5,"y":2,"z":3}]');
let hits = 0;
Object.defineProperty(rows[2], 'y', { get() { hits++; return 4; }, enumerable: true });
for (const name of ['x', 'y', 'z']) rows[6][name] = BigInt(name.charCodeAt(0));
rows.push(Object.create(JSON.parse('{"x":7,"y":8,"z":9}')), new Proxy(JSON.parse('{}'), { get: (_, name) => name.length }));
function each(from) {
  let said = '';
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    try { said += (row.x * row.y - row.z) + ';'; } catch (error) { said += error.constructor.name + ';'; }
  }
  return said + from + ':' + hits;
}
function sum(from) {
  let total = from & 1;
  for (let i = 0; i < rows.length; i++) { const row = rows[i]; if (i !== 6) total += row.x * 2 + row.y - row.z; }
  return total;
}
globalThis.kept = [each, sum];
for (let turn = 0; turn < 3; turn++) console.log(each(turn), sum(turn), kept.x);
