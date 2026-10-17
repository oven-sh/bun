declare const console: { log(...values: unknown[]): void };
interface Item { count: number; price: number; }
function sumLeft(t: number, v: any): number { const n: number = t + v; return n; }
function sumRight(t: number, v: any): number { const n: number = v + t; return n; }
function differenceLeft(t: number, v: any): number { return t - v; }
function differenceRight(t: number, v: any): number { return v - t; }
function productLeft(t: number, v: any): number { return t * v; }
function productRight(t: number, v: any): number { return v * t; }
function quotientLeft(t: number, v: any): number { return t / v; }
function quotientRight(t: number, v: any): number { return v / t; }
function accumulate(t: number, p: Item, q: Item): number { t += p.count; t += q.price; t -= p.price; t *= q.count; t /= p.count; return t; }
function mixed(t: number, p: Item): number { return (t + p.count) * (p.price - t) / (t * p.price + 1); }
function show(x: unknown): string { return Object.is(x, -0) ? "-0" : typeof x === "string" ? JSON.stringify(x) : String(x); }
function tell(name: string, f: () => unknown): void { let said: string; try { said = show(f()); } catch (e) { said = e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "threw " + show(e); } console.log(name + ": " + said); }
const numeric: [string, (t: number, v: any) => number][] = [
    ["t + v", (t, v) => sumLeft(t, v)], ["v + t", (t, v) => sumRight(t, v)], ["t - v", (t, v) => differenceLeft(t, v)], ["v - t", (t, v) => differenceRight(t, v)],
    ["t * v", (t, v) => productLeft(t, v)], ["v * t", (t, v) => productRight(t, v)], ["t / v", (t, v) => quotientLeft(t, v)], ["v / t", (t, v) => quotientRight(t, v)],
];
const numbers = [0, -0, 1, -1, 0.5, 3, NaN, Infinity, -Infinity, 2147483647, -2147483648, 4294967296, 1e300, 5e-324];
let calls = 0;
const values: [string, () => any][] = [
    ["7", () => 7], ["-0", () => -0], ["0.25", () => 0.25], ["NaN", () => NaN], ["2147483647", () => 2147483647], ["1e308", () => 1e308], ["true", () => true], ["false", () => false], ["null", () => null], ["undefined", () => undefined],
    ["an object with valueOf", () => ({ valueOf() { calls++; return 5; } })], ["a Date", () => new Date(86400000)], ["an object whose valueOf throws", () => ({ valueOf() { throw "thrown by valueOf"; } })],
    ["a big integer", () => 10n], ["a symbol", () => Symbol("s")], ["an empty array", () => []], ["a Number object", () => new Number(2.5)],
];
const withoutText = (name: string, value: string) => !(name.includes("+") && (value === "a Date" || value === "an empty array"));
for (let turn = 0; turn < 2; turn++) {
    for (const [name, operation] of numeric) {
        for (const [value, make] of values) if (withoutText(name, value)) for (const t of numbers) tell(show(t) + ": " + name + ", v = " + value, () => operation(t, make()));
        if (!name.includes("+")) for (const text of ["5", "", " 12 ", "x", "0x10", "-0", "1e3"]) tell(name + ", v = " + show(text), () => operation(3, text));
    }
    for (const text of ['{"count":3,"price":2.5}', '{"count":-0,"price":1e300}', '{"count":2147483647,"price":2147483647}', '{"count":0.1,"price":0.2}', '{"price":4,"count":5}']) {
        for (const t of numbers) {
            tell("accumulate " + show(t) + " " + text, () => accumulate(t, JSON.parse(text) as Item, { count: 2, price: 0.5 }));
            tell("accumulate the other way " + show(t) + " " + text, () => accumulate(t, { count: 4, price: 8 }, JSON.parse(text) as Item));
            tell("mixed " + show(t) + " " + text, () => mixed(t, JSON.parse(text) as Item));
        }
    }
}
console.log(calls);
