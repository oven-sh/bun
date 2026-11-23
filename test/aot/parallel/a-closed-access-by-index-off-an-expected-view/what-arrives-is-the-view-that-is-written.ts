// One store and one read at a written index off a field that is written Int32Array | Uint8Array, outside of loops: the access stays a call. What arrives is what is written; positions inside, at the end and outside; values of every kind.
class Shelf {
  words: Int32Array
  bytes: Uint8Array
  constructor(n: number) {
    this.words = new Int32Array(n)
    this.bytes = new Uint8Array(n)
  }
}
function putWord(shelf: Shelf, value: unknown): void {
  shelf.words[2] = value as number
}
function wordAt2(shelf: Shelf): number {
  return shelf.words[2]!
}
function putByte(shelf: Shelf, value: unknown): void {
  shelf.bytes[1] = value as number
}
function byteAt1(shelf: Shelf): number {
  return shelf.bytes[1]!
}
function putAt(shelf: Shelf, at: number, value: unknown): void {
  shelf.words[at | 0] = value as number
}
function at(shelf: Shelf, at: number): number {
  return shelf.words[at | 0]!
}
(globalThis as any).kit = { Shelf, putWord, wordAt2, putByte, byteAt1, putAt, at }
const kit = (globalThis as any).kit
const values: unknown[] = [0, 1, -1, 2147483647, -2147483648, 2147483648, 4294967297, 0.5, -0.5, 1e20, NaN, Infinity, -0, "7", "x", true, null, undefined, { valueOf() { return 9 } }, [5]]
const out: string[] = []
for (const n of [4, 3, 2, 1, 0]) {
  const shelf = new kit.Shelf(n)
  for (const value of values) {
    kit.putWord(shelf, value)
    kit.putByte(shelf, value)
    out.push(String(kit.wordAt2(shelf)) + "/" + String(kit.byteAt1(shelf)))
  }
  for (const where of [0, 1, 2, 3, 4, -1, 1073741824]) {
    kit.putAt(shelf, where, where + 11)
    out.push(String(kit.at(shelf, where)))
  }
}
console.log(out.join(" "))
try { kit.putWord(new kit.Shelf(4), 10n) } catch (e) { console.log((e as Error).constructor.name) }
try { kit.putWord(new kit.Shelf(4), Symbol("s")) } catch (e) { console.log((e as Error).constructor.name) }
