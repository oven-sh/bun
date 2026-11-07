// Nothing is known of the key: a fraction, a text that spells an index, a text that spells none, a symbol, an object. Such an access names nothing that it expects; it must go by the key as the language says.
type Holder = { words: Int32Array; bytes: Uint8Array }
function read(holder: Holder, key: number): unknown {
  return holder.words[key]
}
function write(holder: Holder, key: number, v: number): void {
  holder.bytes[key] = v
}
(globalThis as any).kit = { read, write }
const kit = (globalThis as any).kit
const holder = { words: Int32Array.from([5, 6, 7, 8]), bytes: Uint8Array.from([1, 2, 3, 4]) }
const keys: unknown[] = [0, 1, 0.5, 1.5, -0.5, "1", "01", "1.0", "-0", "length", "byteLength", "x", NaN, "NaN", Infinity, "Infinity", Symbol.toStringTag, { toString() { return "2" } }, [3], null, undefined, true, 2n]
const out: string[] = []
for (let round = 0; round < 2; round++) for (const key of keys) {
  let line = ""
  try { kit.write(holder, key, 50 + round); line += "w" } catch (e) { line += (e as Error).constructor.name }
  try { line += String(kit.read(holder, key)) } catch (e) { line += (e as Error).constructor.name }
  out.push(line)
}
console.log(out.join(" "), Array.from(holder.bytes).join(), Object.keys(holder.bytes).join(), Object.keys(holder.words).join())
