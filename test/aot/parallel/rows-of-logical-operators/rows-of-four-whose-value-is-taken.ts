const call = new Function("f", "a", "b", "c", "d", "return f(a, b, c, d)") as (f: Function, a?: unknown, b?: unknown, c?: unknown, d?: unknown) => any;
const box = { tag: "box" };
const values: unknown[] = [0, 1, -0, NaN, "", "a", null, undefined, false, true, 0n, 2n, box, Symbol.iterator];
let log = "";
function see(name: string, value: unknown) { log += name; return value; }
function show(value: unknown) { return typeof value === "symbol" ? "symbol" : typeof value === "bigint" ? value + "n" : Object.is(value, -0) ? "-0" : value === box ? "box" : String(value); }
let sum = 0;
function mix(text: string) { for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0; }
function run(f: Function, operands: number) {
    sum = 0;
    let first = "";
    const at = [0, 0, 0, 0];
    for (;;) {
        log = "";
        let answer: string;
        try { answer = show(call(f, values[at[0]], values[at[1]], values[at[2]], values[at[3]])) + ":" + log; } catch { answer = "throws:" + log; }
        if (first.length < 60) first += answer + " ";
        mix(answer);
        let place = 0;
        while (place < operands && ++at[place] === values.length) at[place++] = 0;
        if (place === operands) break;
    }
    console.log(f.name, sum, first);
}
function row1(a: unknown, b: unknown, c: unknown, d: unknown) { return a && b && c && d; }
function row2(a: unknown, b: unknown, c: unknown, d: unknown) { return a && b && c || d; }
function row3(a: unknown, b: unknown, c: unknown, d: unknown) { return a && b || c && d; }
function row4(a: unknown, b: unknown, c: unknown, d: unknown) { return a && b || c || d; }
function row5(a: unknown, b: unknown, c: unknown, d: unknown) { return a || b && c && d; }
function row6(a: unknown, b: unknown, c: unknown, d: unknown) { return a || b && c || d; }
function row7(a: unknown, b: unknown, c: unknown, d: unknown) { return a || b || c && d; }
function row8(a: unknown, b: unknown, c: unknown, d: unknown) { return a || b || c || d; }
for (const f of [row1, row2, row3, row4, row5, row6, row7, row8]) run(f, 4);
