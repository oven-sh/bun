// STATISTIC: SiteCachedReadsHoisted >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
function Store() {}
Store.rows = [1.5, 2.5];
function f(t) { let s = t & 1; for (let i = 0; i < Store.rows.length; i++) s = s + Store.rows[i]; return s; }
function tried(t) { try { return f(t); } catch (e) { return e instanceof TypeError ? 'TypeError' : 'other'; } }
const others = [new Float64Array([1.5, -0, q]), '12' + q, JSON.parse('{"0":1,"1":"x","2":' + q + ',"length":3}'), [1.5, q], null];
const said = []; for (let t = 0; t < 60; t++) { if (t % 10 === 5 && t < 55) Store.rows = others[(t - 5) / 10]; if (t === 55) delete Store.rows; said.push(tried(t)); } console.log(said[0], said[5], said[15], said[25], said[35], said[45], said[55]);
