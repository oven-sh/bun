declare const console: { log(...values: unknown[]): void };
function show(v: unknown): string { return typeof v + ":" + (Object.is(v, -0) ? "-0" : String(v)); }
function literal(x: number, y: number): { [name: string]: unknown } { return { a: x, b: x * 0.5, c: x + y, d: y / x, e: -x, f: Math.sqrt(y), g: "text", h: x }; }
function withSpread(base: { [name: string]: unknown }, x: number): { [name: string]: unknown } { return { ...base, a: x * 2, z: x / 3 }; }
function computed(name: string, x: number): { [name: string]: unknown } { return { [name]: x * 1.5, fixed: x * 0.25 }; }
function anything(x: number): unknown { const made: any = { first: x }; made.second = x * 0.5; made.third = x - 0.5; return made; }
class Holder { [name: string]: unknown; constructor(x: number) { this.one = x * 3; this.two = x / 7; } }
function inLoop(xs: number[]): { [name: string]: unknown }[] { const made: { [name: string]: unknown }[] = []; for (let i = 0; i < xs.length; i++) made.push({ index: i, value: xs[i], half: xs[i] / 2 }); return made; }
function tell(o: unknown): string { const record = o as { [name: string]: unknown }; return Object.keys(record).map(k => k + "=" + show(record[k])).join(" ") + " " + JSON.stringify(o); }
const given = [0, -0, 1, -1, 2.5, 1e21, -1e-7, 2147483647, 2147483648, -2147483648, -2147483649, 4294967296, NaN, Infinity, -Infinity, 0.1];
for (let turn = 0; turn < 2; turn++) {
    for (const x of given) {
        for (const y of [1, 0, 2.25, NaN])
            console.log(show(x) + " " + show(y) + ": " + tell(literal(x, y)));
        console.log(tell(withSpread({ a: "old", k: 1 }, x)) + " | " + tell(computed("n" + turn, x)) + " | " + tell(anything(x)) + " | " + tell(new Holder(x)));
    }
    console.log(inLoop(given).map(tell).join(" ; "));
}
