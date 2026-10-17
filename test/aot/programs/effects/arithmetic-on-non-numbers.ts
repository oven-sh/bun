// Arithmetic on operands that may be undefined, null or boolean, with the right side effects.
function flags() {
  var bits: any
  const read = () => (bits & 6) !== 0
  const before = read()
  bits = 7
  return [before, read(), bits | 8, bits ^ 1, bits << 1, bits >> 1, bits >>> 1, ~bits, -bits, +bits, bits % 4, bits ** 2].join()
}
function maybe(n: number | undefined | null, b: boolean) {
  const x: any = n, y: any = b
  return [x & 3, x | 1, x % 2, x ** 2, ~x, -x, x < 1, x >= 0, y & 1, y + 1, y * 2, y < 2, -y, ~y].join()
}
console.log(flags())
console.log(maybe(5, true), maybe(undefined, false), maybe(null, true))
function label(prefix: "a" | "b") {
  var suffix: "x" | "y" | undefined
  const make = (p: "a" | "b") => p + suffix
  const early = make(prefix)
  suffix = "x"
  return early + make(prefix)
}
console.log(label("a"), label("b"))
