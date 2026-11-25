let kept: any;
// @ts-ignore
function swap() { Level = { Low: 9 }; return 1; }
function keep(it: any) { kept = it; return 3; }
enum Level { Low = swap(), Middle = Low + 1, High = keep(Level) }
console.log(JSON.stringify(Level), JSON.stringify(kept));
