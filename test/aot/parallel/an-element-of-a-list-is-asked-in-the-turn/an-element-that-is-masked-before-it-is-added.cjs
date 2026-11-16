'use strict';
const marks = JSON.parse("[" + Array.from({ length: 200 }, (_, i) => (i * 7) % 23).join() + "]");
function tally(t) { let s = 0; for (let i = 0; i < marks.length; i++) s += (marks[i] + (t & 1)) & 7; return s; }
let sum = 0; for (let t = 0; t < 7; t++) sum = (sum + tally(t)) % 1000003;
console.log(sum, tally(0), tally(1));
