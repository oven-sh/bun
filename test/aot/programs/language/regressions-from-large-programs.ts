// Small language features that compiling large programs showed to be missing.
type Box = { inner?: { value: number, get(): number } }
const full: Box = { inner: { value: 4, get() { return this.value + 1 } } }
const empty: Box = {}
// What `get` is called on is of the type that its `this` has. On another object: type-rules/this-checked-on-entry.
const other: NonNullable<Box["inner"]> = { value: 9, get() { return 0 } }
function paren(b: Box): string { try { return "v" + (b.inner?.value)!.toString() } catch (e) { return (e as Error).constructor.name } }
console.log(paren(full), paren(empty), (full.inner?.value)?.toFixed(1), (empty.inner?.value)?.toFixed(1), (full.inner?.get)?.call(other), full.inner?.["get"](), empty.inner?.["get"]())
const table: Record<string, (this: unknown, n: number) => string> = { a(n) { return (this === table) + ":" + n } }
const key = "a"
console.log(table[key](1), table["a"]?.(2), table["b"]?.(3))
// for-of closes the iterator when the body throws, breaks or returns.
const log: string[] = []
function* source() { try { yield 1; yield 2; yield 3 } finally { log.push("closed") } }
try { for (const n of source()) { if (n === 2) throw new Error("thrown at " + n) } } catch (e) { log.push((e as Error).message) }
for (const n of source()) { if (n === 2) break }
function first(): number { for (const n of source()) return n; return 0 }
log.push("first " + first())
try { for (const [a] of (function* () { try { yield 5 as any } finally { log.push("closed after a bad pattern") } })()) log.push("never " + a) } catch (e) { log.push((e as Error).constructor.name) }
const noisy = { [Symbol.iterator]() { return { next() { return { done: false, value: 1 } }, return(): IteratorResult<number> { log.push("return called"); throw new Error("from return") } } } }
try { for (const n of noisy) throw new Error("body wins " + n) } catch (e) { log.push((e as Error).message) }
try { for (const n of noisy) break } catch (e) { log.push((e as Error).message) }
let sum = 0
try { for (const n of [1, 2, 3]) { sum += n; if (n === 2) throw new Error("array") } } catch (e) { log.push((e as Error).message + " " + sum) }
console.log(log.join("\n"))
