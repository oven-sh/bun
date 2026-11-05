// The type is only written. What arrives in the field is another view, a list, a text, a plain object, a proxy, an object with accessors above it, nothing: the call that asks for an Int32Array first goes on as the language says.
type Holder = { words: Int32Array }
function put(holder: Holder, value: number): void {
  holder.words[1] = value
}
function get(holder: Holder): number {
  return holder.words[1]!
}
(globalThis as any).kit = { put, get }
const kit = (globalThis as any).kit
const seen: string[] = []
const above = Object.create({ get 1() { seen.push("get"); return "from above" }, set 1(v: unknown) { seen.push("set " + String(v)) } })
const proxy = new Proxy({}, { get(_t, key) { seen.push("trap get " + String(key)); return 77 }, set(_t, key, v) { seen.push("trap set " + String(key) + " " + String(v)); return true } })
const frozen = Object.freeze([1, 2, 3])
const buffer = new ArrayBuffer(16, { maxByteLength: 64 })
const grown = new Int32Array(buffer)
const gone = new Int32Array(4)
structuredClone(gone.buffer, { transfer: [gone.buffer] })
class Mine extends Int32Array {}
const arrivals: [string, unknown][] = [
  ["Int32Array", new Int32Array(3)], ["Uint8Array", new Uint8Array(3)], ["Float64Array", new Float64Array(3)], ["Uint8ClampedArray", new Uint8ClampedArray(3)], ["BigInt64Array", new BigInt64Array(3)],
  ["short", new Int32Array(1)], ["empty", new Int32Array(0)], ["list", [1, 2, 3]], ["holes", [, , 3]], ["short list", []], ["text", "abc"], ["object", {}], ["keyed", { 1: "one" }],
  ["above", above], ["proxy", proxy], ["frozen", frozen], ["resizable", grown], ["detached", gone], ["subclass", new Mine(3)], ["arguments", (function () { return arguments })(1, 2, 3)],
  ["number", 5], ["null", null], ["undefined", undefined], ["function", function () {}], ["map", new Map()],
]
for (let round = 0; round < 2; round++) {
  for (const [name, words] of arrivals) {
    let line = name + ":"
    try { line += String(kit.get({ words })) } catch (e) { line += (e as Error).constructor.name }
    try { kit.put({ words }, 40 + round); line += " put" } catch (e) { line += " " + (e as Error).constructor.name }
    try { line += " " + String(kit.get({ words })) } catch (e) { line += " " + (e as Error).constructor.name }
    console.log(line)
  }
}
buffer.resize(4)
console.log(String(kit.get({ words: grown })), seen.join(","))
