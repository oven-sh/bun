declare const console: { log(...values: unknown[]): void };
const sink: unknown[] = [];
function lengthOf(a: unknown[]): unknown { return a.length; }
function countUp(n: number): unknown { let t = 0; for (let i = 0; i < n; i++) t += 1; return t; }
function sumOfLengths(a: unknown[], times: number): unknown { let t = 0; for (let i = 0; i < times; i++) t += a.length; return t; }
function scaled(a: unknown[], k: number): unknown { return a.length * 65536 * (k & 65535); }
function shifted(k: number): unknown { return (k >>> 0) + (k >>> 0); }
function unsigned(k: number): unknown { return k >>> 0; }
function below(k: number): unknown { return (k | 0) - 2147483648; }
function above(k: number): unknown { return (k | 0) + 2147483647; }
function product(k: number): unknown { return (k & 0xffff) * (k & 0xffff) * 4; }
function negative(k: number): unknown { return -(k >>> 0); }
class Box { value: unknown = 0; }
function intoField(box: Box, k: number): void { box.value = (k >>> 0) + 1; }
function intoRecord(record: { [name: string]: unknown }, k: number): void { record.value = (k >>> 0) * 3; }
function intoArray(a: unknown[], k: number): void { a[0] = (k >>> 0) + 2147483647; a.push((k >>> 0) - 1); }
function inLoop(a: unknown[], k: number): void { for (let i = 0; i < 4; i++) a[i] = (k >>> 0) + i; }
function show(v: unknown): string { return typeof v + ":" + (Object.is(v, -0) ? "-0" : String(v)); }
const given = [0, 1, -1, 2, 65535, 65536, 2147483646, 2147483647, 2147483648, -2147483648, -2147483647, 4294967295, 4294967294, 1073741824, -1073741824];
for (let turn = 0; turn < 2; turn++) {
    for (const k of given) {
        const box = new Box(), record: { [name: string]: unknown } = {}, a: unknown[] = ["x"], b: unknown[] = [];
        intoField(box, k); intoRecord(record, k); intoArray(a, k); inLoop(b, k);
        console.log(k + ": " + [scaled(a, k), shifted(k), unsigned(k), below(k), above(k), product(k), negative(k), box.value, record.value, a[0], a[1], a[2], b[0], b[3]].map(show).join(" "));
    }
    console.log([lengthOf(given), countUp(5), countUp(0), sumOfLengths(given, 3), lengthOf(new Array(4294967295)), sumOfLengths(new Array(4294967295), 3), lengthOf(new Array(2147483647)), lengthOf(new Array(2147483648))].map(show).join(" "));
}
sink.push(lengthOf, countUp);
