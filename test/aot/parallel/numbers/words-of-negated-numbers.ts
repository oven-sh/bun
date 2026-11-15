// The word of a negated number: lowest bits, Fenwick trees, and masks, of integers, fractions, numbers beyond 32 and 64 bits, NaN and infinities.
class Fenwick { private readonly tree: number[]; constructor(private readonly size: number) { this.tree = new Array(size + 1).fill(0); } add(i: number, d: number): void { for (i++; i <= this.size; i += i & -i) this.tree[i]! += d; } sum(i: number): number { let s = 0; for (; i > 0; i -= i & -i) s += this.tree[i]!; return s; } }
const lowest = (x: number): number => x & -x, negated = (x: number): number => -x | 0, unsigned = (x: number): number => -x >>> 0, shifted = (x: number): number => (-x << 3) ^ (-x >> 2) ^ (1 << -x), twice = (x: number): number => -(-x) | 0;
const numbers: number[] = []; for (const x of [0, 0.5, 1, 1.5, 12, 255, 2147483647, 2147483648, 2147483648.5, 4294967295, 4294967296, 9007199254740993, 1e18, 9223372036854775808, 1e300, Infinity]) numbers.push(x, -x);
numbers.push(NaN);
for (const x of numbers) console.log(x, lowest(x), negated(x), unsigned(x), shifted(x), twice(x), -Math.floor(x) & 255, ~-x, Math.imul(-x, 3));
const f = new Fenwick(20); for (let i = 0; i < 20; i += 3) f.add(i, i * 1.5); console.log([0, 1, 7, 19, 20].map(i => f.sum(i)).join());
let bits = 0b1011000; const set: number[] = []; while (bits) { const low = bits & -bits; set.push(31 - Math.clz32(low)); bits ^= low; } console.log(set.join());
export {};
