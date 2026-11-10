// STATISTIC: ListsExpectedOfPlaces >= 1
'use strict';
const q = Number(process.argv[2] ?? 3); const log = []; let asked = 0, kept;
const P = q > 99 ? JSON.parse(process.argv[3]) : new Proxy([4, q], { get(o, k, r) { log.push(String(k)); return Reflect.get(o, k, r); } });
const O = q > 99 ? JSON.parse(process.argv[3]) : { 0: 'p', 1: 'q', get length() { asked++; return 2; } };
const box = JSON.parse('{"rows":[1,2]}');
function f(t) { for (let i = 0; i < P.length; i++) kept = P[i]; return kept + ':' + t; }
function g(t) { for (let i = 0; i < O.length; i++) kept = O[i]; return kept + ':' + t; }
function h(t) { for (let i = 0; i < box.rows.length; i++) kept = box.rows[i]; return kept + ':' + t; }
let out = [f(1), f(2), log.join(), g(1), g(2), asked, h(1)].join(' '); delete box.rows; try { h(2); } catch (e) { out += ' ' + e.constructor.name + ': ' + e.message; } console.log(out);
