// The key is known to be a whole number and no more: an int32, a number beyond, minus zero, a negative. The value read goes on into arithmetic; the store's value comes out of arithmetic.
type Holder = { words: Int32Array; bytes: Uint8Array }
function read(holder: Holder, i: number): number {
  const at = Math.floor(i)
  return holder.words[at]! + 1
}
function write(holder: Holder, i: number, v: number): void {
  const at = Math.trunc(i)
  holder.bytes[at] = v * 2
}
function both(holder: Holder, i: number): number {
  const at = i >>> 0
  holder.words[at] = holder.bytes[at]! + holder.words[at]!
  return holder.words[at]!
}
(globalThis as any).kit = { read, write, both }
const kit = (globalThis as any).kit
const holder = { words: Int32Array.from([5, 6, 7, 8]), bytes: Uint8Array.from([1, 2, 3, 4]) }
const keys = [0, 1, 3, 4, -1, -0, 0.9, 3.999, 4294967295, 4294967296, 9007199254740991, -9007199254740991, 1e300, NaN, Infinity]
const out: string[] = []
for (let round = 0; round < 2; round++) for (const key of keys) {
  kit.write(holder, key, 100 + round)
  out.push(String(kit.read(holder, key)) + ":" + String(kit.both(holder, key)))
}
console.log(out.join(" "), Array.from(holder.words).join(), Array.from(holder.bytes).join())
