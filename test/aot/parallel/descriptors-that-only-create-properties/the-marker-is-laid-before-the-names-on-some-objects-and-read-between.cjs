'use strict';
const out = [];
function tagThenFill(record, seen) { seen.push(record.__esModule, record.add); Object.defineProperty(record, '__esModule', { value: true }); seen.push(record.__esModule, record.add); record.add = x => x + 1; seen.push(typeof record.add); }
function onlySome(record, tagged) { record.add = x => x + 2; if (tagged) Object.defineProperty(record, '__esModule', { value: true }); }
const first = {}, second = {}, third = {}, seen = [];
tagThenFill(first, seen); onlySome(second, true); onlySome(third, false);
out.push(JSON.stringify(seen.map(String)), String(second.__esModule), String(third.__esModule), String('__esModule' in third), Object.getOwnPropertyNames(third).join(), Object.getOwnPropertyNames(second).join());
function hot(t) { let s = 0; for (const record of [first, second, third]) { for (let i = 0; i < 20; i++) s += record.add(i) + (record.__esModule ? 3 : 5) + (record.missing === undefined ? 1 : 100); } return s + t % 3; }
const n = 50; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + hot(t)) % 1000003;
third.missing = 9; out.push(String(hot(0)));
console.log(out.join('\n')); console.log(sum);
