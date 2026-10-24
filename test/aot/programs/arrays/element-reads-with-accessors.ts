declare const console: { log(...values: unknown[]): void };
let depth = 0;
function at<T>(array: readonly T[], index: number): unknown { if (depth > 0) { depth--; at(array, index); } return array[index | 0]; }
function atUnknown(array: unknown[], index: number): unknown { if (depth > 0) { depth--; atUnknown(array, index); } const integer = index | 0; return array[integer]; }
function atNumber(array: unknown[], index: number): unknown { if (depth > 0) { depth--; atNumber(array, index); } return array[index]; }
function describe(value: unknown): string { return value === undefined ? "undefined" : value === null ? "null" : typeof value + ":" + String(value); }
function report(name: string, run: () => unknown): void {
    let text: string;
    try { text = String(run()); } catch (error) { text = error instanceof TypeError ? "TypeError" : "threw " + String(error); }
    console.log(name + ": " + text);
}
let calls = 0;
const arrays: [string, () => unknown[]][] = [
    ["accessor among integers", () => { const array: unknown[] = [1, 2, 3]; Object.defineProperty(array, "1", { get() { calls++; return "computed"; } }); return array; }],
    ["accessor among doubles", () => { const array: unknown[] = [1.5, 2.5, 3.5]; Object.defineProperty(array, "1", { get() { calls++; return "computed"; } }); return array; }],
    ["accessor among strings", () => { const array: unknown[] = ["a", "b", "c"]; Object.defineProperty(array, "1", { get() { calls++; return "computed"; } }); return array; }],
    ["accessor past the end", () => { const array: unknown[] = ["a"]; Object.defineProperty(array, "2", { get() { calls++; return "computed"; } }); return array; }],
    ["accessor that throws", () => { const array: unknown[] = ["a", "b"]; Object.defineProperty(array, "1", { get() { calls++; throw new RangeError("no element"); } }); return array; }],
    ["accessor without a getter", () => { const array: unknown[] = ["a", "b"]; Object.defineProperty(array, "1", { set(_value: unknown) { calls++; } }); return array; }],
];
const indexes = [0, 1, 2, 3, 100, -1, 2147483647, -2147483648];
for (let round = 0; round < 2; round++) {
    for (const [name, make] of arrays) {
        for (const index of indexes) {
            report(name + " [" + index + "]", () => describe(at(make(), index)) + " " + describe(atUnknown(make(), index)) + " " + describe(atNumber(make(), index)));
        }
        report(name + " [1.5]", () => describe(atNumber(make(), 1.5)));
        report(name + " [NaN]", () => describe(atNumber(make(), NaN)));
    }
}
console.log("calls: " + calls);
