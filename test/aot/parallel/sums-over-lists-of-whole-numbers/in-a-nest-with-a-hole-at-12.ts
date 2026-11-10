// STATISTIC: UnrolledLoopIntegerElementSums >= 1
function sum(list: number[], from: number): number { let s = from; for (const r of [list, list]) for (const v of r) s += v; return s; }
const list: number[] = new Array(26); for (let j = 0; j < 26; j++) if (j !== 12) list[j] = j + 1;
console.log(sum(list, 0), sum(list, 5));
