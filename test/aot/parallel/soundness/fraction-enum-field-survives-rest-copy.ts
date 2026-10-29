// A field of an enum type takes any number. A copy of the object (rest, spread, Object.assign) holds the same number.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
const never = process.argv.length > 99;
const key: string = never ? "a" : "k";
const enum E { Zero = 0, One = 1 }
interface H { a: E; k: E; b: E; }
function make(): H { return { a: E.One, k: E.One, b: E.One }; }
function readK(o: H): unknown { return o.k; }
function copied(o: H): unknown { const c: H = { a: E.One, k: E.One, b: E.One }; c.k = o.k; return (c as any)[key]; }
function rest(v: any): H { const s = make(); s.k = v; const { ...o } = s; return o; }
const values: any[] = [0, 2147483648, -2147483649, 0.5, -0, -2147483647];
for (let i = never ? 1 : 0; i < values.length; i++) {
    const o: any = rest(values[i]);
    console.log(values[i], readK(o), copied(o), o[key], Object.prototype.hasOwnProperty.call(o, key));
}
