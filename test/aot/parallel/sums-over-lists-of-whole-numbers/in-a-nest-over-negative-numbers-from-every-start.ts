// STATISTIC: UnrolledLoopIntegerElementSums >= 1
function sum(list: number[], from: number): number { let s = from; for (const r of [list, list]) for (const v of r) s += v; return s; }
const show = (x: number) => Object.is(x, -0) ? "-0" : String(x);
const list: number[] = []; for (let j = 0; j < 43; j++) list.push(-j * 1000003 | 0);
console.log(show(sum(list, 0)));
console.log(show(sum(list, -0)));
console.log(show(sum(list, 0.5)));
console.log(show(sum(list, -0.25)));
console.log(show(sum(list, 2 ** 52)));
console.log(show(sum(list, 2 ** 52 + 1)));
console.log(show(sum(list, 2 ** 53 - 20)));
console.log(show(sum(list, 2 ** 53 - 1)));
console.log(show(sum(list, -(2 ** 52))));
console.log(show(sum(list, -(2 ** 53) + 3)));
console.log(show(sum(list, 4503599627370495.5)));
console.log(show(sum(list, NaN)));
console.log(show(sum(list, Infinity)));
console.log(show(sum(list, -Infinity)));
console.log(show(sum(list, 1e300)));
