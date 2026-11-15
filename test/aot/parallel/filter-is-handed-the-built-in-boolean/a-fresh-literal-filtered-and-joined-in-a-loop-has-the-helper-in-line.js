// filter() is copied into the loop with the built-in known: the test for it folds to yes. The helper with the loop bears the library's mark and is copied with the text that calls it: no call is left in the turn.
// STATISTIC: CallsInlined >= 2
"use strict";
const words = JSON.parse('["a","","b",null,"c"]');
function line(t) { let s = 0; for (let i = 0; i < 8; i++) s += [words[i % 5], words[(i + t) % 5], "x"].filter(Boolean).join(" ").length; return s; }
const n = +JSON.parse('"3"'); let sum = 0; for (let t = 0; t < n; t++) sum = (sum + line(t)) % 1000003; console.log(sum);
