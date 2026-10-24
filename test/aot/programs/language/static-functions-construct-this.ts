// Static factory methods that create an instance of the class they are called on (`new this()`).
const a = Uint8Array.of(1, 2, 300)
const b = Float64Array.of(1.5, 2.5)
console.log(a.length, a[2], a instanceof Uint8Array, b[1], b.constructor.name)
// A check for an object that is not a function, and for one of several known functions.
function one() { return 1 }
function two() { return 2 }
function pick(x: unknown): string {
  if (typeof x === "object" && x !== null) return "object"
  if (typeof x === "function") return "function"
  return typeof x
}
function anything(): any { return [{}, one, two, null, 3, [], () => 0, new Map(), /x/] }
console.log(anything().map(pick).join())
const table: Record<string, () => number> = { one, two }
const found: (() => number) | undefined = table[(anything()[4] === 3 ? "two" : "one")]
console.log(found === two, found!())
const onlyObject = anything()[0] as Record<string, unknown>
console.log(Object.keys(onlyObject).length)
// A boolean that lives across an await in an async generator.
async function* flags(n: number) {
  for (let i = 0; i < n; i++) {
    const even = i % 2 === 0
    await null
    if (even) yield "even " + i
    else yield "odd " + i
  }
}
for await (const f of flags(3)) console.log(f)
