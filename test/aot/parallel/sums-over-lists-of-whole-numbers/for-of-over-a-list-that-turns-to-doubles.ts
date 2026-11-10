// STATISTIC: SumsOfElementsAddedAsIntegers >= 1
function sum(list: number[], from: number): number { let s = from; for (const v of list) s += v; return s; }
const list: number[] = []; for (let j = 0; j < 40; j++) list.push(j);
console.log(sum(list, 0));
list[20] = 2 ** 31;
console.log(sum(list, 0));
