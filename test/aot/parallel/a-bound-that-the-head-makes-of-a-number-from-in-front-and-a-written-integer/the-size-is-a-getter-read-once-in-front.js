// STATISTIC: NumbersBesideCountersAskedInFrontOfLoops >= 1
const list = JSON.parse('[1,2,3,4,5,6,7,8,9,10]');
let reads = 0;
const holder = { get size() { reads++; return 10 - reads; }, list };
function sum(h) { const { size } = h; let s = 0; for (let i = 0; i < size - 1; i++) s += h.list[i]; return s; }
console.log(sum(holder), reads, sum(holder), reads);
