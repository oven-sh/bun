// A counter walks a view and its bound has nothing to do with the view's length: below it, at it, beyond it. Beyond the end a read gives undefined: a sum becomes NaN, `| 0` makes it 0 again, a comparison tells it. Every kind of view of numbers.
type View = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array
function wrapped(view: Int32Array, n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum = (sum + view[i]!) | 0; return sum }
function plain(view: Int32Array, n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += view[i]!; return sum }
function missing(view: Int32Array, n: number): number { let count = 0; for (let i = 0; i < n; i++) if (view[i] === undefined) count++; return count }
function strided(view: Int32Array, n: number): number { let sum = 0; for (let i = 0; i < n; i++) { const o = i * 3; sum = (sum + view[o]! * 2 + view[o + 2]!) | 0 } return sum }
function last(view: Int32Array, n: number): unknown { let seen: unknown = "none"; for (let i = 0; i < n; i++) seen = view[i]; return seen }
function bytes(view: Uint8Array, n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum = (sum + view[i]!) | 0; return sum }
function wide(view: Uint32Array, n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += view[i]!; return sum }
function floats(view: Float64Array, n: number): number { let sum = 0; for (let i = 0; i < n; i++) sum += view[i]!; return sum }
function any(view: View, n: number): string { let out = ""; for (let i = 0; i < n; i++) out += String(view[i]) + ","; return out }
(globalThis as any).kit = { wrapped, plain, missing, strided, last, bytes, wide, floats, any }
const kit = (globalThis as any).kit
const show = (v: unknown) => Object.is(v, -0) ? "-0" : String(v)
for (let round = 0; round < 2; round++) for (const size of [0, 1, 4, 7]) {
  const words = Int32Array.from({ length: size }, (_, i) => (i + 1) * (i & 1 ? -3 : 5))
  const line: unknown[] = []
  for (const n of [0, 1, size - 1, size, size + 1, size + 5]) line.push(kit.wrapped(words, n), kit.plain(words, n), kit.missing(words, n), kit.strided(words, n), kit.last(words, n), kit.bytes(Uint8Array.from(words), n), kit.wide(Uint32Array.from(words), n), kit.floats(Float64Array.from(words, x => x / 2), n))
  console.log(size, line.map(show).join(" "))
}
for (const make of [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array]) console.log(make.name, kit.any(make.from([1, 200, -3, 70000]), 6))
