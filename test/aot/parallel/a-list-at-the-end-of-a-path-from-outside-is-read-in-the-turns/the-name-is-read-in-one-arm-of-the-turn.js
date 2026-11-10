// STATISTIC: ReadsByNameThatAskTheirSitesAlone = 0
var held = JSON.parse('{"inner":{"rate":3}}');
var memo;
function f(t) { let s = t & 1; for (let i = 0; i < 100; i++) s = s + ((memo === undefined ? held.inner : memo).rate + (memo === undefined ? held.inner : memo).rate) | 0; return s >>> 0; }
const rounds = +process.argv[2] || 3;
for (let r = 0; r < rounds; r++) { console.log(f(r)); if (r == 1) memo = { rate: 5 }; if (r == 2) { memo = undefined; Object.defineProperty(held, "inner", { get() { return { rate: 7 }; } }); } }
console.log(f(0));
