declare const console: { log(...values: unknown[]): void };
function show(v: number): string { return Object.is(v, -0) ? "-0" : String(v); }
const by: [string, (x: number) => number][] = [
    ["1", x => x % 1], ["2", x => x % 2], ["3", x => x % 3], ["5", x => x % 5], ["7", x => x % 7], ["8", x => x % 8], ["10", x => x % 10], ["60", x => x % 60], ["100", x => x % 100], ["641", x => x % 641],
    ["1000", x => x % 1000], ["65535", x => x % 65535], ["65536", x => x % 65536], ["65537", x => x % 65537], ["1000000007", x => x % 1000000007], ["2147483647", x => x % 2147483647], ["2147483648", x => x % 2147483648],
    ["4294967295", x => x % 4294967295], ["-1", x => x % -1], ["-7", x => x % -7], ["-2147483648", x => x % -2147483648], ["0", x => x % 0], ["-0", x => x % -0], ["0.5", x => x % 0.5], ["7.5", x => x % 7.5], ["Infinity", x => x % Infinity], ["NaN", x => x % NaN],
];
function sums(a: number[]): string { let p = 0, q = 0, r = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; p += x % 7; q += x % 10; r += x % 1000000007; } return show(p) + " " + show(q) + " " + show(r); }
function byVariable(a: number[], n: number): number { let t = 0; for (let i = 0; i < a.length; i++) t += a[i] % n; return t; }
const given = [0, -0, 1, 2, 3, 6, 7, 8, 13, 14, 99, 100, 640, 641, 642, 65535, 65536, 1000000006, 1000000007, 1000000008, 2147483646, 2147483647, 2147483648, 4294967295, 4294967296, 9007199254740991, -1, -6, -7, -8, -2147483648, -2147483649, 0.5, 6.999, 7.5, -7.5, 1e21, NaN, Infinity, -Infinity];
for (let turn = 0; turn < 2; turn++) {
    for (const [name, f] of by)
        console.log("% " + name + ": " + given.map(f).map(show).join(" "));
    console.log(sums([1, 2, 3, 100, 2147483647]) + " | " + sums(given) + " | " + sums([]) + " | " + [7, 1, 0, -3, 2.5].map(n => show(byVariable([1, 20, 300, 2147483647], n))).join(" "));
}
