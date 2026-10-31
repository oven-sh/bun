// === and == of two numbers, whichever way each arrives: out of a variable that anybody may store to, an array of anything, a parameter, a computation.
const values: any[] = [0, -0, 1, -1, 0.5, -0.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 9007199254740991, 9007199254740992, 1e300, 5e-324, 42, 42.0, 41.99999999999999];
let held: any = 0;
function hold(value: any) { held = value; }

function isZero(): boolean { const x: number = held; return x === 0; }
function isMinusOne(): boolean { const x: number = held; return x === -1; }
function isFortyTwo(): boolean { const x: number = held; return 42 === x; }
function isLeast(): boolean { const x: number = held; return x === -2147483648; }
function isHalf(): boolean { const x: number = held; return x === 0.5; }
function looselyZero(): boolean { const x: number = held; return x == 0; }
function notZero(): boolean { const x: number = held; return x !== 0; }
function same(a: number, b: number): boolean { return a === b; }
function looselySame(a: number, b: number): boolean { return a == b; }
function twice(a: number, b: number): boolean { return a * 2 === b; }
function counted(list: any[], wanted: number): number {
    let count = 0;
    for (let i = 0; i < list.length; i++) {
        const x: number = list[i];
        if (x === wanted) count++;
        if (x === i) count += 100;
    }
    return count;
}

const show = (x: number) => Object.is(x, -0) ? "-0" : String(x);
for (const value of values) {
    hold(value);
    console.log(show(value), isZero(), isMinusOne(), isFortyTwo(), isLeast(), isHalf(), looselyZero(), notZero(), counted(values, value));
}
let bits = "";
for (const a of values) {
    for (const b of values) bits += (same(a, b) ? 1 : 0) + (looselySame(a, b) ? 2 : 0) + (twice(a, b) ? 4 : 0);
    bits += " ";
}
console.log(bits);
let hits = 0;
for (let round = 0; round < 2000; round++) {
    hold(round % 3 === 0 ? 0 : round % 3 === 1 ? -0 : round);
    if (isZero()) hits++;
    if (looselyZero()) hits += 10000;
    if (same(held, round)) hits += 100000000;
}
console.log(hits);
// What is no number at all, through `any`.
for (const odd of [undefined, null, "0", "", false, true, 0n, {}, [], [0]] as any[]) {
    hold(odd);
    console.log(typeof odd, isZero(), looselyZero(), notZero(), same(odd, 0), looselySame(odd, 0), same(odd, odd), looselySame(0, odd));
}
