// Numbers and array element reads in edge cases: everything must behave exactly as ECMAScript specifies.
function count(from: number, step: number, times: number): string { let x = from, s = ""; for (let i = 0; i < times; i++) { x += step; s += x + "," } return s }
function down(from: number, step: number, times: number): string { let x = from, s = ""; for (let i = 0; i < times; i++) { x -= step; s += x + "," } return s }
function hash(text: string): number { let h = 7; for (let i = 0; i < text.length; i++) h = h * 31 + text.charCodeAt(i); return h }
function fnv(text: string): number { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = (h * 16777619) >>> 0 } return h }
function double(times: number): number { let x = 1; for (let i = 0; i < times; i++) x += x; return x }
function sign(x: number): string { return x === 0 ? (1 / x > 0 ? "+0" : "-0") : "" + x }
function sum(a: Int32Array, times: number): number { let s = 0; for (let k = 0; k < times; k++) for (let i = 0; i < a.length; i++) s += a[i]!; return s }
console.log(count(9007199254740988, 1, 8))
console.log(count(9007199254740988, 2, 6), count(9007199254740988, 3, 6), count(9007199254740000, 255, 8))
console.log(down(-9007199254740988, 1, 8), down(-9007199254740988, 3, 6))
console.log(count(4611686018427387000, 256, 4), count(4611686018427387904, 1, 2), count(4611686018427387904, 256, 3))
console.log(hash("the quick brown fox jumps over the lazy dog"), fnv("the quick brown fox"), 94906267 * 94906267, 94906267 * 94906266)
console.log(double(52), double(53), double(54), double(63), double(64), double(100), double(1100))
const zero = [0, 1, -1, 4, -4, 2]
console.log(sign(zero[0]! * zero[2]!), sign(-zero[0]!), sign(zero[4]! % zero[5]!), sign(zero[3]! % zero[5]!), sign(zero[2]! * zero[0]!), sign(zero[0]! * zero[1]!), sign(zero[0]! - zero[0]!), sign(-zero[1]!))
const big = new Int32Array(4); big[0] = 2147483647; big[1] = 2147483647; big[2] = -5; big[3] = 2147483647
console.log(sum(big, 3), sum(big, 3000000))
