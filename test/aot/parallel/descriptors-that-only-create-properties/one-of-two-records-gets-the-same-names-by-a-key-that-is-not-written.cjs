'use strict';
const K = JSON.parse('["add","__esModule","extra"]');
function fill(record) { record.add = x => x + 1; Object.defineProperty(record, '__esModule', { value: true }); }
function over(record, key, value) { Object.defineProperty(record, key, { value, configurable: true }); }
const plain = {}, changed = {};
fill(plain); fill(changed); over(changed, K[0], x => x + 100); over(changed, K[2], 7);
function hot(t) { let s = 0; for (let i = 0; i < 30; i++) s += plain.add(i) + changed.add(i) + (plain.extra === undefined ? 1 : 50) + (changed.extra === undefined ? 1 : 50); return s + t % 2; }
const n = 50; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + hot(t)) % 1000003;
console.log(Object.getOwnPropertyNames(changed).join(), Object.keys(changed).join(), changed.extra, plain.extra); console.log(sum);
