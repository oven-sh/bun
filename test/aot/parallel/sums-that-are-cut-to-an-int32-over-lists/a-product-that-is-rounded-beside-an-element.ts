function f(xs: number[], a: number, b: number): number { let s = 0; for (let i = 0; i < xs.length; i++) s = ((a * b) + xs[i]!) | 0; return s; }
function g(xs: number[], a: number): number { let s = 1; for (let i = 0; i < xs.length; i++) s = (s * a + xs[i]!) | 0; return s; }
const l: number[] = []; l.push(1);
const given = JSON.parse("[94906267, 94906267, 3, 4, 1103515245]") as number[];
console.log(f(l, given[0]!, given[1]!), f(l, given[2]!, given[3]!));
const long: number[] = []; for (let i = 0; i < 20; i++) long.push(2147483647 - i);
console.log(g(long, given[4]!), g(long, given[0]!), g(l, given[4]!));
delete long[13]; console.log(g(long, given[4]!), g(long, given[0]!));
