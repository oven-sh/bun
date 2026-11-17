// STATISTIC: WalkLoopsVersioned >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
const key = Symbol('rows'), holder = { [key]: JSON.parse('[' + Array.from({ length: 40 }, (_, i) => i + q + 0.5).join() + ']') };
function f(t) { let s = t & 1; for (let i = 0; i < holder[key].length; i++) s = s + holder[key][i] * 2; return s; }
const said = []; for (let t = 0; t < 30; t++) f(t); said.push(f(0)); holder[key] = 'ab'; said.push(f(0)); holder[key] = [q]; said.push(f(1)); delete holder[key]; try { f(0); } catch (e) { said.push(e instanceof TypeError); } console.log(said.join());
