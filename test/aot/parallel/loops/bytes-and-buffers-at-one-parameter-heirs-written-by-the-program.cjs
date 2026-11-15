// STATISTIC: AccessesInsideViews >= 9
'use strict';
const said = [];
const attempt = (f) => { try { return f(); } catch (error) { return error.constructor.name; } };
const q = +(process.argv[2] ?? 3);
const b = Buffer.alloc(100, 7), u = new Uint8Array(100).fill(5);
const hidden = (f) => ({ f })[JSON.parse('"f"')];
const add = p => { let s = 0; for (let i = 0; i < p.length; i++) s = (s + p[i]) | 0; return s; };
class Short extends Uint8Array { get length() { return q; } }
class Plain extends Uint8Array {}
class Below extends Buffer {}
said.push(add(b), add(u), add(new Short(10).fill(1)), add(new Plain(10).fill(1)), attempt(() => add(Below.from([2, 2, 2]))));
console.log(said.join(' | '));
