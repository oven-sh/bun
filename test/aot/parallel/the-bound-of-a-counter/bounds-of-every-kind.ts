// `for (let i = 0; i < n; i++)` over a view, with n whatever arrives: an int32, a fraction, NaN, minus zero, an infinity, 2^31 and its neighbours, a negative, a text, null, undefined, a boolean, a bigint, an object that counts how often it is asked.
function upTo(words: Int32Array, n: any): string { let sum = 0, turns = 0; for (let i = 0; i < n; i++) { turns++; sum = (sum + (words[i * 2] ?? 100)) | 0; if (turns === 12) break } return turns + ":" + sum }
function through(words: Int32Array, n: any): string { let sum = 0, turns = 0; for (let i = 0; i <= n; i++) { turns++; sum = (sum + (words[i] ?? 100)) | 0; if (turns === 12) break } return turns + ":" + sum }
function byTwo(words: Int32Array, n: any): string { let sum = 0, turns = 0; for (let at = 0; at < n; at += 2) { turns++; sum = (sum + (words[at] ?? 100)) | 0; if (turns === 12) break } return turns + ":" + sum }
function downTo(words: Int32Array, n: any): string { let sum = 0, turns = 0; for (let i = 7; i > n; i--) { turns++; sum = (sum + (words[i] ?? 100)) | 0; if (turns === 12) break } return turns + ":" + sum }
function product(words: Int32Array, a: number, b: number): string { const n = a * b; let sum = 0, turns = 0; for (let i = 0; i < n; i++) { turns++; sum = (sum + (words[i] ?? 100)) | 0; if (turns === 12) break } return turns + ":" + sum }
function turned(words: Int32Array, n: any): string { let sum = 0, turns = 0; for (let i = 0; n > i; i++) { turns++; sum = (sum + (words[i] ?? 100)) | 0; if (turns === 12) break } return turns + ":" + sum }
(globalThis as any).kit = { upTo, through, byTwo, downTo, product, turned }
const kit = (globalThis as any).kit
const words = Int32Array.from([1, 2, 3, 4, 5, 6, 7, 8])
let asked = 0
const counting = { valueOf() { asked++; return 3 } }
const bounds: unknown[] = [0, 1, 3, 8, 9, 2.5, 0.5, -0.5, NaN, -0, Infinity, -Infinity, 2147483647, 2147483648, 4294967296, -1, -2147483648, "5", "x", "", null, undefined, true, false, 4n, counting, [6], {}]
for (let round = 0; round < 2; round++) for (const n of bounds) {
  const line: string[] = []
  for (const run of [kit.upTo, kit.through, kit.byTwo, kit.downTo, kit.turned]) { try { line.push(run(words, n)) } catch (e) { line.push((e as Error).constructor.name) } }
  console.log(typeof n, String(typeof n === "object" && n !== null ? "object" : typeof n === "bigint" ? n + "n" : Object.is(n, -0) ? "-0" : n), line.join(" "), asked)
}
for (const [a, b] of [[2, 3], [0.5, 5], [1.5, 1.5], [65536, 32768], [65536, 65536], [-1, 3], [NaN, 1], [0, Infinity]]) console.log(a, b, kit.product(words, a, b))
