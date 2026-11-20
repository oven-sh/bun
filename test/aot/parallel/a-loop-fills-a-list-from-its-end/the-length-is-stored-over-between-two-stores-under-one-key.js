// The second store under one key counts on the test of the first. Between them the length is stored over: the second store lands behind the end and makes the list long again.
// STATISTIC: IndexedStoresCompiledAsAppends = 0
'use strict';
function f(t) { const a = []; for (let i = 0; i < 40; i++) { a[i] = i * 0.5 + t; if (i === 20) a.length = 10; a[i] = a[i] + 1.5; } return a.length + "|" + a.join(); }
const n = 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); for (const part of all.split(/[|,]/)) console.log("SAID " + (part === "" ? "empty" : part));
