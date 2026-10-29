// NaN has many bit patterns, and a remainder by zero makes one with the sign set. A number that was tested and unboxed is still the value that was read.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
const divisors: any[] = [null, 0, undefined, false, "", [], "x", NaN, -0, 3];
const key: string = process.argv.length > 99 ? "a" : "k";
function inverse(u: any): number { return 1 / u[key]; }
function doubled(u: any): number { return u.k * 2; }
function same(u: any): boolean { return Object.is(u[key], NaN); }
function held(u: any): boolean { return [u.k].includes(NaN) && new Set([u.k, NaN]).size === 1; }
for (const divisor of divisors) {
    const o: any = { a: 1, k: 7 % divisor };
    console.log(String(divisor), inverse(o), doubled(o), same(o), held(o), o.k === o.k, -o.k, Math.abs(o.k), Math.sign(o.k));
}
