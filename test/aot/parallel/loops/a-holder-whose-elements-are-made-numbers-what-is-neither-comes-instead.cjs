// STATISTIC: LoopsBuiltForListsAndForTexts >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
let entered = 0;
let held = '123';
function lay(value) { held = value; }
function f(t) { let c = t & 1; for (let i = 0; i < held.length; i++) c += Number(held[i]); return c; }
function tried(t) { try { return f(t); } catch (e) { return e instanceof TypeError ? 'TypeError' : 'other'; } }
const others = ['4' + q, ['1', '2.5', q], new String('78'), new Uint8Array([1, 2, q]), { length: 2, 0: '5', 1: { valueOf() { entered++; return q; } } }, new Proxy(['1', '2'], { get(target, key, receiver) { entered += 100; return Reflect.get(target, key, receiver); } }), ['x', null, undefined, true, ''], [1n, 2n], [Symbol.iterator], null, '😀' + q, ''];
const said = []; for (let t = 0; t < 30; t++) tried(t);
for (const other of others) { lay(other); let last; for (let t = 0; t < 4; t++) last = tried(t); said.push(last); } console.log(said.join(), entered);
