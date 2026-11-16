// What is not equal to an end of its range: recursion down to zero, masks, lengths, both sides, loops, tail calls and sums of constants through 32 bits.
function even(x: number): boolean { return x === 0 ? true : odd(x - 1); }
function odd(x: number): boolean { return x === 0 ? false : even(x - 1); }
const out: unknown[] = [];
for (const x of [0, 1, 2, 7, 20, 100001, 2147483647 - 2147483600]) out.push(even(x), odd(x));
function count(x: number, n: number): number { return x === 0 ? n : count(x - 1, n + x); }
out.push(count(0, 5), count(1, 0), count(1000, 0.5), count(4095, 2 ** 52));
function masked(k: number): number { const m = k & 7; if (m === 0) return -1; if (m === 7) return 100; return 64 / m + (m - 1 - 1); }
for (let k = -9; k < 20; k++) out.push(masked(k));
function below(k: number): number { const m = k & 255; if (0 === m) return 0; return (m - 1) >>> 0; }
let n = 0; for (let k = 0; k < 1000; k++) n += below(k); out.push(n);
function ends(list: number[]): number { let i = list.length; if (i === 0) return -1; i--; if (i === 0) return list[0]!; return list[i - 1]!; }
out.push(ends([]), ends([4]), ends([4, 5]), ends([1, 2, 3]));
function down(x: number): number { let steps = 0; while (x !== 0) { x = x - 1; steps++; if (steps > 50) return -steps; } return steps; }
out.push(down(0), down(9), down(-1), down(0.5), down(-0));
function bytes(text: string): number { let sum = 0; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c === 0) return sum; if (c === 65535) sum -= 1; else sum += c - 1 - 1; } return sum; }
out.push(bytes("abc"), bytes("a\0b"), bytes("￿￿z"));
console.log(out.join(" "));
