// Consts of a module whose one store is a written number or boolean, read in functions that leave the file's sight: as an index, an operand, a bound, a flag, a case. Every kind of literal that can be written.
const ZERO = 0
const ONE = 1
const MINUS = -1
const LOWEST = -0x80000000
const HIGHEST = 0x7fffffff
const BEYOND = 0x80000000
const WIDE = 9007199254740991
const HALF = 0.5
const MINUS_ZERO = -0
const HUGE = 1e300
const TINY = 5e-324
const YES = true
const NO = false
const AT_LONG = 2, AT_SHORT = 3
export const SHOWN = 41
function all(): unknown[] {
  return [ZERO, ONE, MINUS, LOWEST, HIGHEST, BEYOND, WIDE, HALF, MINUS_ZERO, HUGE, TINY, YES, NO, AT_LONG, AT_SHORT, SHOWN]
}
function at(words: Int32Array, list: string[]): string {
  return words[AT_LONG] + ":" + words[AT_SHORT] + ":" + list[ONE] + ":" + list[ZERO] + ":" + String(list[MINUS]) + ":" + String(words[BEYOND])
}
function sums(x: number): number[] {
  return [x + ONE, x * HALF, x | LOWEST, x & HIGHEST, x >>> ZERO, x - WIDE, x / MINUS_ZERO, x * HUGE, x + TINY, x % AT_SHORT, x << AT_LONG, SHOWN - x]
}
function pick(x: number): string {
  switch (x) {
    case ZERO: return "zero"
    case ONE: return "one"
    case LOWEST: return "lowest"
    case HALF: return "half"
    default: return YES && !NO ? "other" : "never"
  }
}
function same(x: unknown): boolean[] {
  return [x === ZERO, x === MINUS_ZERO, Object.is(x, MINUS_ZERO), Object.is(x, ZERO), x === YES, x == NO, x === LOWEST, x === BEYOND]
}
(globalThis as any).kit = { all, at, sums, pick, same }
const kit = (globalThis as any).kit
const show = (v: unknown) => Object.is(v, -0) ? "-0" : String(v)
for (let round = 0; round < 2; round++) {
  console.log(kit.all().map(show).join(" "))
  console.log(kit.at(Int32Array.from([5, 6, 7, 8]), ["a", "b"]))
  for (const x of [0, 1, -1, 0.5, 2147483647, -2147483648, 1e10, NaN]) console.log(kit.sums(x).map(show).join(" "), kit.pick(x))
  for (const x of [0, -0, true, false, -2147483648, 2147483648, "0", null]) console.log(kit.same(x).join(" "))
}
