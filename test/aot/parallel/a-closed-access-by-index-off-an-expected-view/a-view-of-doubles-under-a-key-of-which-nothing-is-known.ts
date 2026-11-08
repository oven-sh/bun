// The holder's field is written to be a view of doubles; of the key nothing is known. An index finds its element; everything else goes by the key as the language says. What is stored: whole numbers, fractions, NaN, minus zero, infinities, and what is no number at all.
type Holder = { cells: Float64Array }
function read(holder: Holder, key: any): unknown {
  return holder.cells[key]
}
function write(holder: Holder, key: any, v: any): void {
  holder.cells[key] = v
}
(globalThis as any).kit = { read, write }
const kit = (globalThis as any).kit
const holder = { cells: Float64Array.from([5.5, 6, -0, NaN, 1e300, -7.25]) }
const keys: unknown[] = [0, 1, 2, 3, 4, 5, 6, -1, -0, 0.5, 1.5, 2147483647, 2147483648, 4294967295, 4294967296, "1", "01", "1.0", "-0", "length", "byteLength", "x", NaN, "NaN", Infinity, "Infinity", Symbol.toStringTag, { toString() { return "2" } }, [3], null, undefined, true, 2n]
const asked: string[] = []
const values: unknown[] = [7, 7.5, -0, 0, NaN, Infinity, -Infinity, 2147483648, -2147483649, 1e-320, "8.5", "x", null, undefined, true, { valueOf() { asked.push("valueOf"); return 9.5 } }, [10], 3n, Symbol.iterator]
const show = (x: unknown) => typeof x === "number" && x === 0 && 1 / x < 0 ? "-0" : String(x)
const out: string[] = []
for (let round = 0; round < 2; round++) for (const key of keys) {
  let line = ""
  try { line += show(kit.read(holder, key)) } catch (e) { line += (e as Error).constructor.name }
  try { kit.write(holder, key, 50.25 + round); line += "w" } catch (e) { line += (e as Error).constructor.name }
  try { line += show(kit.read(holder, key)) } catch (e) { line += (e as Error).constructor.name }
  out.push(line)
}
for (let round = 0; round < 2; round++) for (const value of values) for (const key of [1, 9, "2"]) {
  let line = ""
  try { kit.write(holder, key, value); line += "w" } catch (e) { line += (e as Error).constructor.name }
  line += show(kit.read(holder, key))
  out.push(line)
}
console.log(out.join(" "), Array.from(holder.cells, show).join(), Object.keys(holder.cells).join(), asked.length)
