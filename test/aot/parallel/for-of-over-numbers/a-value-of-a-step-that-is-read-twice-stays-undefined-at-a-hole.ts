// A hole is read as NaN only where the element's one reader is arithmetic beside a number. Read twice, joined to a text or compared, it stays undefined.
// STATISTIC: StepsOfListsThatReadHolesAsNaN >= 4
function twice(list: number[]): string { let s = 0; let t = ""; for (const v of list) { s += v; t += String(v) + ","; } return s + " " + t; }
function text(list: number[]): string { let t = "x"; for (const v of list) t += v; return t; }
function test(list: number[]): number { let n = 0; for (const v of list) if (v === undefined) n++; return n; }
function others(list: number[]): string { let a = 100, b = 1, c = 1, d = 0; for (const v of list) a -= v; for (const v of list) b *= v; for (const v of list) c = v / c; for (const v of list) d = v + d; return a + " " + b + " " + c + " " + d; }
const list: number[] = []; for (let j = 1; j < 12; j++) list.push(j);
for (let k = 0; k < 40; k++) { twice(list); text(list); test(list); others(list); }
console.log(twice(list), text(list), test(list), others(list));
delete list[4];
console.log(twice(list), text(list), test(list), others(list));
