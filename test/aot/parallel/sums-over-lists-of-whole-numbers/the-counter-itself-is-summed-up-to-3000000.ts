function sum(n: number, from: number): number { let s = from; for (let i = 0; i < n; i++) s += i; return s; }
const show = (x: number) => Object.is(x, -0) ? "-0" : String(x);
console.log(show(sum(3000000, 0)));
console.log(show(sum(3000000, -0)));
console.log(show(sum(3000000, 0.5)));
console.log(show(sum(3000000, -0.25)));
console.log(show(sum(3000000, 2 ** 52)));
console.log(show(sum(3000000, 2 ** 52 + 1)));
console.log(show(sum(3000000, 2 ** 53 - 20)));
console.log(show(sum(3000000, 2 ** 53 - 1)));
console.log(show(sum(3000000, -(2 ** 52))));
console.log(show(sum(3000000, -(2 ** 53) + 3)));
console.log(show(sum(3000000, 4503599627370495.5)));
console.log(show(sum(3000000, NaN)));
console.log(show(sum(3000000, Infinity)));
console.log(show(sum(3000000, -Infinity)));
console.log(show(sum(3000000, 1e300)));
