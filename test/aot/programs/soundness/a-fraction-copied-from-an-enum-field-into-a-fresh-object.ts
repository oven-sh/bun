// A field of an enum type takes any number. The value copied from it into a fresh object of the same type is that number.
declare const console: { log(...values: unknown[]): void };
declare const process: { argv: string[] };
const key: string = process.argv.length > 99 ? "a" : "k";
const enum E { Zero = 0, One = 1 }
type H = { a: E; k: E; b: E };
const values: any[] = [0, 2147483648, -2147483649, 0.5, 5e-324];
function show(x: unknown): string { return typeof x === "string" ? JSON.stringify(x) : String(x); }
function copied(o: H): unknown { const c: H = { a: E.One, k: E.One, b: E.One }; c.k = o.k; return (c as any)[key]; }
for (let i = 0; i < values.length; i++) {
    const o: any = Object.fromEntries([["a", E.One], ["k", values[i]], ["b", E.One]]);
    console.log(show(values[i]), show(copied(o)), show(Object.prototype.hasOwnProperty.call(o, key)));
}
