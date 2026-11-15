// STATISTIC: WalkLoopsVersioned >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
let entered = 0;
exports.rows = JSON.parse('[1.5,2.5,3.5]');
function f(t) { let s = t & 1; for (let i = 0; i < exports.rows.length; i++) s = s + exports.rows[i] * 2; return s; }
function tried(t) { try { return f(t); } catch (e) { return e instanceof TypeError ? 'TypeError' : 'other'; } }
const others = [new Float64Array([1.5, -0, q]), '12' + q, JSON.parse('{"0":1,"1":"7","2":' + q + ',"length":3}'), new Proxy([1, 2, q], { get(target, key, receiver) { entered++; return Reflect.get(target, key, receiver); } }), null, undefined, [q], ['4', q, null, true], [1, , q], [1n]];
const said = []; for (let t = 0; t < 30; t++) tried(t);
for (const other of others) { exports.rows = other; let last; for (let t = 0; t < 4; t++) last = tried(t); said.push(last); }
delete exports.rows; said.push(tried(0)); Object.defineProperty(exports, 'rows', { get() { entered += 1000; return [q, q]; }, configurable: true }); said.push(tried(0)); console.log(said.join(), entered);
