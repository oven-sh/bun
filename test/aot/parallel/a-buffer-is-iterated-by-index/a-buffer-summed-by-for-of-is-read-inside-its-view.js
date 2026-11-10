// STATISTIC: AccessesInsideViews >= 1
// STATISTIC: IteratorsSteppedWithoutCall = 0
function main(passes) { const b = Buffer.alloc(4096, 7); let s = 0; for (let t = 0; t < passes; t++) for (const x of b) s = (s + x) | 0; return s; }
console.log(main(3));
