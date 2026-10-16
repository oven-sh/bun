declare const console: { log(...values: unknown[]): void };
const given: number[] = [0, -0, 1, -1, 2, 3, 7, 8, 255, 256, -256, 65535, 65536, 1073741824, 2147483647, -2147483648, 2147483648, 4294967295, 4294967296, -4294967297, 9007199254740991, 0.5, -2.5, 1e21, NaN, Infinity];
function mixed(a: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) { const x = a[i]; t += ((x << 3) ^ (x >> 2)) & 255; } return t; }
function masks(a: number[]): string { let s = ""; for (let i = 0; i < a.length; i++) { const x = a[i] | 0; s += ((x << 1) & 255) + "," + ((x >> 1) & -256) + "," + ((x << 2) | -2147483648) + "," + ((x >> 3) ^ -1) + "," + ((x << 4) & 2147483647) + ";"; } return s; }
function pairs(a: number[]): string { let s = ""; for (let i = 0; i + 1 < a.length; i++) { const x = a[i] | 0, y = a[i + 1] | 0; s += ((x << 1) & (y >> 1)) + "," + ((x + 1 | 0) | (y << 2)) + "," + ((x >> 2) ^ (y >> 3)) + "," + (((x << 1) ^ (y << 1)) >>> 0) + ";"; } return s; }
function tested(a: number[]): number { let n = 0; for (let i = 0; i + 1 < a.length; i++) { const x = a[i] | 0, y = a[i + 1] | 0; if (((x << 1) & (y << 1)) !== 0) n += 1; if (((x >> 1) | (y >> 1)) < 0) n += 10; if (((x << 2) ^ (y << 2)) === 0) n += 100; if (((x << 3) & 1024) > 0) n += 1000; } return n; }
function asNumbers(a: number[]): number { let t = 0; for (let i = 0; i + 1 < a.length; i++) { const x = a[i] | 0, y = a[i + 1] | 0; t += ((x << 1) ^ (y >> 1)) * 0.5 + ((x >> 1) & (y << 1)) / 4; } return t; }
function hash(a: number[]): number { let h = 17; for (let i = 0; i < a.length; i++) { h = ((h << 5) - h + (a[i] | 0)) | 0; h ^= h >>> 13; h = (h & 0x7fffffff) ^ (h >> 7); } return h; }
function wide(a: number[]): string { let s = ""; for (let i = 0; i < a.length; i++) { const n = a.length * 1000003 + i; s += (n & 255) + "," + (n | 1) + "," + (n ^ -1) + "," + ((n * 4099) & 65535) + ";"; } return s; }
function once(x: number, y: number): string { return ((x << 1) & (y << 1)) + " " + ((x >> 1) | (y >> 1)) + " " + ((x << 1) ^ (y >> 1)) + " " + (((x | 0) & 255) + ((y | 0) & -256)); }
function flags(a: number[]): number { let f = 0; for (let i = 0; i < a.length; i++) { const bit = 1 << (i & 31); if ((a[i] | 0) & 1) f |= bit; else f &= ~bit; if (f & (bit << 1)) f ^= bit; } return f; }
for (let turn = 0; turn < 2; turn++) {
    for (const [name, make] of [["given", () => given.slice()], ["parsed", () => JSON.parse("[1,2,3,-4,255,256,2147483647,-2147483648,0]") as number[]], ["none", (): number[] => []]] as [string, () => number[]][])
        console.log(name + ": " + mixed(make()) + " # " + masks(make()) + " # " + pairs(make()) + " # " + tested(make()) + " # " + asNumbers(make()) + " # " + hash(make()) + " # " + wide(make()) + " # " + flags(make()));
    console.log(given.map((x, i) => once(x, given[(i + 5) % given.length])).join(" | "));
}
