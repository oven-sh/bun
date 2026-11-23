// A view of doubles is written; what arrives is another kind of view, a view over a buffer that was handed away or that grows and shrinks, an instance of a class over the view, a list, a record, a text, nothing.
type Holder = { cells: Float64Array }
function read(holder: Holder, key: any): unknown {
  return holder.cells[key]
}
function write(holder: Holder, key: any, v: any): void {
  holder.cells[key] = v
}
(globalThis as any).kit = { read, write }
const kit = (globalThis as any).kit
class Row extends Float64Array { get 7() { return 77 } }
const gone = new Float64Array(4); gone[1] = 1.5; structuredClone(gone.buffer, { transfer: [gone.buffer] })
const room = new ArrayBuffer(32, { maxByteLength: 64 }), tracking = new Float64Array(room), fixed = new Float64Array(room, 8, 2)
const frozen = Object.freeze([1.5, 2.5]), sparse = [0.5, , 2.5]
const strangers: unknown[] = [new Float32Array([1.5, 2.25, 3]), new Int32Array([1, 2, 3]), new Uint8ClampedArray([1, 2, 3]), new BigInt64Array([1n, 2n]), new Row([1.5, 2.5, 3.5]), gone, tracking, fixed, [1, 2.5, "three"], frozen, sparse, { 0: "zero", 1: 1.5, length: 2 }, "abc", new String("de"), 5, null, undefined, new Proxy(new Float64Array([4.5, 5.5]), {})]
const show = (x: unknown) => typeof x === "number" && x === 0 && 1 / x < 0 ? "-0" : String(x)
const out: string[] = []
for (let round = 0; round < 3; round++) {
  if (round === 1) room.resize(64)
  if (round === 2) room.resize(8)
  for (const cells of strangers) for (const key of [0, 1, 2, 3, 7, -1, "1"]) {
    let line = ""
    try { line += show(kit.read({ cells }, key)) } catch (e) { line += (e as Error).constructor.name }
    try { kit.write({ cells }, key, 0.75 + round); line += "w" } catch (e) { line += (e as Error).constructor.name }
    try { line += show(kit.read({ cells }, key)) } catch (e) { line += (e as Error).constructor.name }
    out.push(line)
  }
}
console.log(out.join(" "))
