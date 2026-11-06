// if (x), !x, x && y, x || y, x ? a : b, while (x) on a number, whichever way it arrives: out of a variable that anybody may store to, an array of anything, a parameter, a computation.
const values: any[] = [0, -0, 1, -1, 0.5, -0.5, NaN, Infinity, -Infinity, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, 9007199254740992, 1e300, 5e-324, -5e-324];
let held: any = 0;
function hold(value: any) { held = value; }

function taken(): string { const x: number = held; if (x) return "taken"; return "not"; }
function negated(): boolean { const x: number = held; return !x; }
function both(y: number): number { const x: number = held; return x && y; }
function either(y: number): number { const x: number = held; return x || y; }
function chosen(): number { const x: number = held; return x ? 1 : 2; }
function product(y: number): boolean { const x: number = held; return !!(x * y); }
function countDown(): number { let x: number = held, turns = 0; while (x && turns < 5) { x = x > 0 ? x - 1 : x + 1; turns++; } return turns; }
function truthy(list: any[]): number {
    let count = 0;
    for (let i = 0; i < list.length; i++) {
        const x: number = list[i];
        if (x) count++;
    }
    return count;
}

const show = (x: number) => Object.is(x, -0) ? "-0" : String(x);
for (const value of values) {
    hold(value);
    console.log(show(value), taken(), negated(), show(both(7)), show(either(7)), chosen(), product(0), product(1), countDown());
}
console.log(truthy(values));
let hits = 0;
for (let round = 0; round < 3000; round++) {
    hold(round % 4 === 0 ? 0 : round % 4 === 1 ? -0 : round % 4 === 2 ? NaN : round);
    if (taken() === "taken") hits++;
    if (negated()) hits += 10000;
}
console.log(hits);
// What is no number at all, through `any`.
for (const odd of [undefined, null, "0", "", false, true, 0n, 1n, {}, []] as any[]) {
    hold(odd);
    console.log(typeof odd, taken(), negated(), chosen());
}
