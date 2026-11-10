// STATISTIC: SumsOfElementsAddedAsIntegers >= 1
function sum(list: number[], from: number): number { let s = from; for (const v of list) s += v; return s; }
const list: number[] = new Array(26); for (let j = 0; j < 26; j++) if (j !== 23) list[j] = j + 1;
console.log(sum(list, 0), sum(list, 5));
