// STATISTIC: ArraysGuardedUnderSpeculatedCounters >= 1
const rounds = +process.argv[2]! || 3;
function horner(c: any, x: number, from: any): number { let s = 0, i = from; while (i-- > 0) s = s * x + c[i]; return s; }
function fill(list: any, from: any, v: number): number { let i = from, n = 0; while (i-- > 0) { list[i] = v + i; n++; } return n; }
const sizes: any[] = JSON.parse('[4,0,1,3.5,-2,9,"3",null]');
sizes.push(NaN, undefined);
const out: string[] = [];
for (let r = 0; r < rounds; r++) for (const size of sizes) { const c: any[] = JSON.parse("[0.5,1.5,2.5,3.5]"); out.push(String(horner(c, 0.5, size)) + ":" + fill(c, size, 0.25) + ":" + Object.keys(c).join("") + ":" + c.length); }
console.log(out.join(" "));
