// toReversed, toSorted and with create a typed array of the element type, so a Buffer gives a plain Uint8Array. slice and subarray ask the species.
function describe(label, bytes) {
  console.log(label, bytes instanceof Buffer, bytes instanceof Uint8Array, Object.getPrototypeOf(bytes) === Uint8Array.prototype, bytes.constructor.name, Array.from(bytes).join(), typeof bytes.readUInt8)
}
const buffer = Buffer.from([3, 1, 2])
describe("toReversed", buffer.toReversed())
describe("toSorted", buffer.toSorted())
describe("toSorted with a comparator", buffer.toSorted((a, b) => b - a))
describe("with", buffer.with(0, 9))
describe("subarray", buffer.subarray(1))
describe("slice", buffer.slice(1))
describe("the typed array's slice", Uint8Array.prototype.slice.call(buffer, 1))
describe("map", buffer.map(byte => byte * 2))
describe("filter", buffer.filter(byte => byte > 1))

class Bytes extends Uint8Array {
  first() { return this[0] }
}
const bytes = Bytes.of(5, 4)
for (const copy of [bytes.toReversed(), bytes.toSorted(), bytes.with(1, 7), bytes.slice(), bytes.subarray(0)])
  console.log(copy instanceof Bytes, copy.constructor.name, typeof copy.first, Array.from(copy).join())

function sumReversed(source) {
  const reversed = source.toReversed()
  let sum = 0
  for (let i = 0; i < reversed.length; i++) sum += reversed[i] * (i + 1)
  return sum + (reversed instanceof Buffer ? 1000 : 0)
}
console.log(sumReversed(buffer), sumReversed(Uint8Array.of(3, 1, 2)), sumReversed(bytes))
