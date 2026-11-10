// STATISTIC: ConstantsOfFilesReadInFrontOfLoops >= 1
const q = Number(process.argv[2] ?? 3);
function* walk() { let s = 0, i = 0; do { yield s; s = s + rows[i]; i++; } while (i < rows.length); return s; }
const early = walk(); early.next();
var rows = JSON.parse('[1,2.5,' + q + ',4]');
const late = walk(); let a, b; while (!(a = early.next()).done); while (!(b = late.next()).done); console.log(a.value, b.value);
