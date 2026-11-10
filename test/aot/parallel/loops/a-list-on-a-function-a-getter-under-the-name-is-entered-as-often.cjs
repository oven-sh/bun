// STATISTIC: ReadsThatAskTheirSitesBuiltInFrontOfLoops >= 1
'use strict';
const q = Number(process.argv[2] ?? 3);
function Store() {}
Store.rows = [1.5, 2.5, q]; let entered = 0;
function f(t) { let s = t & 1; for (let i = 0; i < Store.rows.length; i++) s = s + Store.rows[i] * 2; return s; }
const said = []; for (let t = 0; t < 40; t++) { if (t === 20) Object.defineProperty(Store, 'rows', { configurable: true, get() { entered++; return [100.5, q]; } }); said.push(f(t)); } console.log(said[0], said[19], said[20], said[39], entered);
