// Variables and fields that hold a number or `undefined`: what arithmetic on `undefined` yields is NaN, and is stored as NaN.
declare const console: { log(...values: unknown[]): void };
function show(value: unknown): string { return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value); }
function makeCounter() {
    const api = { up, down, add, scale, read, kind, clear, set };
    early.push(show(api.read()), api.kind(), show(api.up()), api.kind(), show(api.read()));
    var count = 0;
    function up(): number { count++; return count; }
    function down(): number { count--; return count; }
    function add(by: number): number { count += by; return count; }
    function scale(by: number): number { count *= by; return count; }
    function read(): number { return count; }
    function kind(): string { return typeof count; }
    function clear(): void { count = undefined!; }
    function set(to: number): void { count = to; }
    return api;
}
const early: string[] = [];
const counter = makeCounter();
console.log(early.join(" "));
console.log(show(counter.read()), show(counter.up()), show(counter.up()), show(counter.down()), show(counter.add(2.5)), show(counter.scale(-0)), show(counter.scale(5)), counter.kind());
for (const value of [NaN, Infinity, -Infinity, -0, 5e-324, 2 ** 53, -(2 ** 31), 0.1]) {
    counter.set(value);
    console.log(show(counter.read()), show(counter.up()), show(counter.down()), show(counter.add(value)), show(counter.scale(0)), show(counter.scale(NaN)), show(counter.read()), counter.kind());
}
class Row { width?: number; height: number | undefined = undefined; depth: number | null = null; }
function grow(row: Row, by: number): string {
    row.width = (row.width as number) + by;
    row.height = (row.height as number) * by;
    row.depth = (row.depth as number) - by;
    return show(row.width) + " " + show(row.height) + " " + show(row.depth) + " " + typeof row.width + " " + typeof row.height + " " + ("width" in row) + " " + (row.height === undefined) + " " + (row.depth === null);
}
const row = new Row();
console.log(show(row.width), show(row.height), show(row.depth), "width" in row);
console.log(grow(row, 1));
console.log(grow(row, 2));
row.width = 1; row.height = 2; row.depth = 3;
console.log(grow(row, 0.5), "|", grow(row, -0), "|", grow(row, NaN), "|", grow(row, 1));
row.width = undefined; row.height = undefined; row.depth = null;
console.log(show(row.width), show(row.height), show(row.depth), "width" in row, JSON.stringify(row));
const bits = new Float64Array(1), words = new Uint32Array(bits.buffer);
for (const high of [0x7ffa0000, 0x7ffb0000, 0x7ffc0000, 0xfffa0000, 0x7ff80001, 0x7ff00001]) {
    words[0] = 0; words[1] = high;
    counter.set(bits[0]); row.width = bits[0]; row.height = bits[0] + 1; row.depth = -bits[0];
    console.log(show(counter.read()), counter.kind(), show(counter.up()), show(row.width), typeof row.width, show(row.height), typeof row.height, show(row.depth), typeof row.depth, row.depth === null, row.height === undefined);
}
