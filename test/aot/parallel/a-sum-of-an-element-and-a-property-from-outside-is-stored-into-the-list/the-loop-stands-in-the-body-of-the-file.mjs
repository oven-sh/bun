// COUNT: operation:operationAOTGetByIdAndCache = 0
const a = JSON.parse("[0.5,1.25,2.5,3.75,4.5,5.25,6.5,7.75]"), o = JSON.parse('{"k":1.5,"c":0.25}'), n = +process.argv[2] || 1000;
let s = 0;
for (let t = 0; t < n; t++) s += a[t & 7] * o.k + o.c;
console.log(Math.floor(s) & 1048575);
