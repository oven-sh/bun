// A large function that uses `arguments` or a rest parameter and is only ever called by name (like TypeScript's `reduceLeft`).
// IR= 0 run = Call v
// IR= 0 run = CallMethod
// IR+ CallDirect \(v[0-9]+\) function=f[0-9]+
declare const console: any;
function pad(x: number): number { let s = 0; for (let i = 0; i < 2; i++) { s += x + i; s ^= i; s += x * 2; s -= i; s |= 0; s += 7; s ^= x; s += 11; s -= 3; s += x & 5; s ^= 9; s += 13; s -= x >> 1; s += 17; } return s; }
function reduceLeft(array: number[], f: (memo: number, value: number, i: number) => number, initial?: number, start?: number, count?: number): number {
    const size = array.length;
    if (size > 0) {
        let pos = start === undefined || start < 0 ? 0 : start;
        const end = count === undefined || pos + count > size - 1 ? size - 1 : pos + count;
        let result: number;
        if (arguments.length <= 2) { result = array[pos]; pos++; } else { result = initial!; }
        while (pos <= end) { result = f(result, array[pos], pos); pos++; }
        return result + pad(size) * 0 + pad(pos) * 0;
    }
    return initial === undefined ? -1 : initial;
}
function sumOfRest(first: number, ...rest: number[]): number { let s = first; for (let i = 0; i < rest.length; i++) s += rest[i]; return s + pad(first) * 0 + pad(rest.length) * 0 + pad(s) * 0; }
const list = [1, 2, 3];
const add = (a: number, b: number): number => a + b;
let total = 0;
function run(n: number): void { for (let i = 0; i < n; i++) total += reduceLeft(list, add) + reduceLeft(list, add, i & 3) + sumOfRest(i & 1, 2, 3); }
run(2_000_000);
console.log(total, reduceLeft([], add), reduceLeft([], add, 5), reduceLeft(list, add, 0, 1), reduceLeft(list, add, 0, 1, 0), sumOfRest(1), sumOfRest(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
export {};
