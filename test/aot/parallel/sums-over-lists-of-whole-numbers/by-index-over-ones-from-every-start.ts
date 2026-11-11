// STATISTIC: UnrolledLoopIntegerElementSums >= 1
// Under: --aot-testing=CheckBoundsInEmittersOnly: the turns are laid out as users build them, and every raw access asks its position at the run
function sum(list: number[], from: number): number { let s = from; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
const show = (x: number) => Object.is(x, -0) ? "-0" : String(x);
const list: number[] = []; for (let j = 0; j < 40; j++) list.push(1);
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
