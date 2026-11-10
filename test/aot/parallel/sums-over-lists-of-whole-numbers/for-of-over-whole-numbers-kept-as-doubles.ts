// STATISTIC: SumsOfElementsAddedAsIntegers >= 1
function sum(list: number[], from: number): number { let s = from; for (const v of list) s += v; return s; }
const list: number[] = []; for (let j = 0; j < 40; j++) list.push(1700000000000 + j);
console.log(sum(list, 0), sum(list, 0.5));
