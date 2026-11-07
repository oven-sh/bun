// The key comes out of arithmetic: it is a number and no more is known: a product, a remainder, a quotient, a sum. Whole ones find their element; a fraction, NaN, an infinity, a negative, minus zero, one beyond the length or beyond an int32 go as the language says.
type Holder = { words: Int32Array; bytes: Uint8Array }
function putAtProduct(holder: Holder, a: number, b: number, v: number): void {
  const at = +a * +b
  holder.words[at] = v
  holder.words[at + 1] = v + 1
}
function atProduct(holder: Holder, a: number, b: number): string {
  const at = +a * +b
  return String(holder.words[at]) + "," + String(holder.words[at + 1])
}
function putAtRemainder(holder: Holder, a: number, n: number, v: number): void {
  const at = +a % +n
  holder.bytes[at] = v
}
function atRemainder(holder: Holder, a: number, n: number): unknown {
  return holder.bytes[+a % +n]
}
function atQuotient(holder: Holder, a: number, n: number): unknown {
  return holder.words[+a / +n]
}
function putAtQuotient(holder: Holder, a: number, n: number, v: number): void {
  holder.words[+a / +n] = v
}
(globalThis as any).kit = { putAtProduct, atProduct, putAtRemainder, atRemainder, atQuotient, putAtQuotient }
const kit = (globalThis as any).kit
const pairs: [number, number][] = [[0, 8], [1, 2], [1, 3], [2, 2], [3, 2], [0.5, 2], [0.5, 3], [1.5, 1.5], [-1, 1], [-0, 1], [0, -1], [1e5, 1e5], [65536, 65536], [4294967296, 1], [2147483647, 1], [2147483648, 1], [NaN, 1], [Infinity, 1], [Infinity, 0], [7, 0], [1e-7, 1], [1e21, 1]]
const strangers: unknown[] = [[1, 2, 3, 4, 5, 6, 7, 8], { 0: "zero", 1: "one", 0.5: "half", NaN: "nan", "-1": "minus", Infinity: "inf" }, "abcdefgh", new Float64Array(8), null]
const out: string[] = []
for (let round = 0; round < 2; round++) {
  const holder = { words: new Int32Array(8), bytes: new Uint8Array(8) }
  for (const [a, b] of pairs) {
    kit.putAtProduct(holder, a, b, 100 + round)
    kit.putAtRemainder(holder, a, b, 200 + round)
    kit.putAtQuotient(holder, a, b, 300 + round)
    out.push(kit.atProduct(holder, a, b) + "|" + String(kit.atRemainder(holder, a, b)) + "|" + String(kit.atQuotient(holder, a, b)))
  }
  out.push(Array.from(holder.words).join() + ";" + Array.from(holder.bytes).join() + ";" + Object.keys(holder.words).length + ";" + Object.keys(holder.bytes).length)
  for (const stranger of strangers) for (const [a, b] of pairs.slice(0, 12)) {
    let line = ""
    try { line += kit.atProduct({ words: stranger }, a, b) } catch (e) { line += (e as Error).constructor.name }
    try { line += "|" + String(kit.atQuotient({ words: stranger }, a, b)) } catch (e) { line += "|" + (e as Error).constructor.name }
    try { if (typeof stranger !== "string") kit.putAtQuotient({ words: stranger }, a, b, 7); line += "|put" } catch (e) { line += "|" + (e as Error).constructor.name }
    out.push(line)
  }
}
console.log(out.join("\n"))
