// The reverse mapping of a flags enum has the keys 1, 2, 4 .. 1 << 30: each index is twice the last one. Such an object, or an array filled the same way, holds its 31 elements sparsely instead of growing a vector of 8 GB.
declare const console: { log(...values: unknown[]): void };
declare const process: { memoryUsage(): { rss: number } };
enum Flags {
    None = 0,
    F0 = 1 << 0, F1 = 1 << 1, F2 = 1 << 2, F3 = 1 << 3, F4 = 1 << 4, F5 = 1 << 5, F6 = 1 << 6, F7 = 1 << 7,
    F8 = 1 << 8, F9 = 1 << 9, F10 = 1 << 10, F11 = 1 << 11, F12 = 1 << 12, F13 = 1 << 13, F14 = 1 << 14, F15 = 1 << 15,
    F16 = 1 << 16, F17 = 1 << 17, F18 = 1 << 18, F19 = 1 << 19, F20 = 1 << 20, F21 = 1 << 21, F22 = 1 << 22, F23 = 1 << 23,
    F24 = 1 << 24, F25 = 1 << 25, F26 = 1 << 26, F27 = 1 << 27, F28 = 1 << 28, F29 = 1 << 29, F30 = 1 << 30,
    Low = F0 | F1 | F2,
}
const before = process.memoryUsage().rss;
console.log(Flags[1 << 29], Flags[1 << 30], Flags[7], Flags[0], Flags.F12, Object.keys(Flags).length);

const list: string[] = [];
const table: Record<number, string> = {};
for (let bit = 0; bit < 31; bit++) {
    list[2 ** bit] = "l" + bit;
    table[2 ** bit] = "t" + bit;
}
console.log(list.length, list[1 << 20], list[3], Object.keys(list).length, table[1 << 30], Object.keys(table).join());

const everyOther: number[] = [];
for (let i = 0; i < 300000; i++) everyOther[i * 2] = i;
let sum = 0;
for (let i = 0; i < everyOther.length; i += 2) sum += everyOther[i];
console.log(everyOther.length, sum);

console.log("stays small:", process.memoryUsage().rss - before < 256 * 1024 * 1024);
