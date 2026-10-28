// The array for `...xs: number[]` and a literal that goes to a number[] hold whatever the call passes: numbers of every kind, and what an element read past the end yields.
// An array that leaves the function is made as an array of numbers; one that is only read is never made: a read at an index that is not known chooses among the arguments.
// IR= 1 keptOfThree : Array<number>\S* = NewArray 
// IR= 0 restOfThree NewArray
// IR= 1 restOfThree Switch v[0-9]+ \[0: b[0-9]+\(v[0-9]+\), 1: b[0-9]+\(v[0-9]+\), 2: b[0-9]+\(v[0-9]+\)\]
const lines: string[] = [];
function show(value: unknown): string {
    if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
    if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
    return typeof value === "string" ? JSON.stringify(value) : String(value);
}
function sum(...xs: number[]): number {
    let s = 0;
    for (let k = 0; k < xs.length; k++) s += xs[k];
    return s;
}
function keep(...xs: number[]): number[] { return xs; }
function behindTwo(a: number, b: string, ...xs: number[]): string { return a + b + show(xs) + xs.length; }
function firstIsMissing(...xs: number[]): boolean { return xs[0] === undefined; }
function count(...xs: number[]): number { return xs.length; }
class Adder {
    base = 10;
    add(...xs: number[]): number { let s = this.base; for (const x of xs) s += x; return s; }
    kept(...xs: number[]): number[] { return xs; }
    static all(...xs: number[]): string { return show(xs); }
}
const source: number[] = [1.5, 2, -0, NaN, Infinity, 2147483648, -2147483649, 0.1];
const holes: number[] = [1, , 3] as number[];
const empty: number[] = [];

for (let i = 0; i < source.length + 2; i++) {
    const v = source[i];
    lines.push("sum " + i + ": " + show(sum(v, v + 1, v + 2)) + " " + show(keep(v, v + 1, v + 2)) + " " + firstIsMissing(v) + " " + count(v, v));
}
for (let i = 0; i < 4; i++) lines.push("holes " + i + ": " + show(keep(holes[i], 7)) + " " + show(sum(holes[i], 7)) + " " + (0 in keep(holes[i])));
lines.push("none: " + show(keep()) + " " + sum() + " " + count() + " " + firstIsMissing());
lines.push("one to six: " + [sum(1), sum(1, 2), sum(1, 2, 3), sum(1, 2, 3, 4), sum(1, 2, 3, 4, 5), sum(1, 2, 3, 4, 5, 6)].join(" "));
lines.push("halves: " + [sum(0.5), sum(0.5, 1.5), sum(0.5, 1.5, 2.5), sum(0.5, 1.5, 2.5, 3.5), sum(0.5, 1.5, 2.5, 3.5, 4.5)].join(" "));
lines.push("seventeen: " + sum(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17.5) + " " + keep(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, empty[0]).length);
lines.push("behind two: " + behindTwo(1, "x") + " " + behindTwo(1, "x", 2.5) + " " + behindTwo(1, "x", empty[0], NaN, -0));

const kept = keep(1.5, empty[3], 2.5);
lines.push("kept: " + show(kept) + " " + kept.indexOf(2.5) + " " + kept.includes(undefined as unknown as number) + " " + JSON.stringify(kept) + " " + Object.keys(kept).join());
const withNaN = keep(NaN, 1);
lines.push("NaN: " + withNaN.includes(NaN) + " " + withNaN.indexOf(NaN) + " " + (0 in withNaN) + " " + show(withNaN) + " " + JSON.stringify(withNaN));
const zeros = keep(-0, 0);
lines.push("zeros: " + show(zeros) + " " + Object.is(zeros[0], -0) + " " + Object.is(zeros[1], 0) + " " + 1 / zeros[0]);

const changed = keep(1, 2.5);
(changed as unknown[]).push("text", null, { a: 1 });
changed[7] = 4;
lines.push("changed: " + show(changed) + " " + changed.length + " " + (5 in changed));
const grown = keep(0.25);
for (let i = 0; i < 40; i++) grown.push(i / 4);
lines.push("grown: " + grown.length + " " + sum(...grown) + " " + grown[40]);
const sorted = keep(3.5, empty[0], 1.5, NaN, -1).sort();
lines.push("sorted: " + show(sorted));

const adder = new Adder();
for (let i = 6; i < 10; i++) lines.push("method " + i + ": " + show(adder.add(source[i], 1)) + " " + show(adder.kept(source[i], source[i + 1])) + " " + Adder.all(source[i], 0.5));
const table: ((...xs: number[]) => number)[] = [sum, count, (...xs: number[]) => xs.length ? xs[xs.length - 1] : -1];
for (let i = 0; i < 6; i++) lines.push("by value " + i + ": " + show(table[i % 3](source[i + 5], 0.5, source[i])));
const anything: any = sum;
lines.push("from untyped: " + show(anything(1, 2.5)) + " " + show(anything()) + " " + show(anything(undefined, 1)) + " " + show((keep as any)(0.5, undefined, 1)) + " " + show((keep as any)(1, 2, 3)));
lines.push("spread: " + show(sum(...source)) + " " + show(keep(...holes)) + " " + show(keep(0.5, ...holes, empty[0])));

function pair(v: number): number[] { return [v, v + 0.5]; }
function triple(v: number, w: number): number[] { const made: number[] = [v, w, v + w]; return made; }
for (let i = 6; i < 10; i++) lines.push("literal " + i + ": " + show(pair(source[i])) + " " + show(triple(source[i], source[i - 3])) + " " + (0 in pair(source[i])));
let total = 0;
for (let round = 0; round < 2000; round++) for (let i = 0; i < source.length + 1; i++) { const v = source[i]; const s = sum(v, 1, 2); if (s === s && s !== Infinity) total += s; }
lines.push("total: " + total);
function restOfThree(v: number): number { return sum(v, v + 1, v + 2); }
function keptOfThree(v: number): number[] { return keep(v, v + 1, v + 2); }
const asValues = [restOfThree];
lines.push("called as a value: " + show(asValues[source.length & 0](1.5)));
const alsoAsValues = [keptOfThree];
lines.push("kept, called as a value: " + show(alsoAsValues[source.length & 0](1.5)));
console.log(lines.join("\n"));
