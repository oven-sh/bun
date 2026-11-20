// STATISTIC: UnrolledLoopIntegerElementSums >= 1
function sum(list: number[], from: number): number { let s = from; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
const list: number[] = []; for (let j = 0; j < 2200003; j++) list.push(2147483647);
console.log(sum(list, 2 ** 52 - 5));
