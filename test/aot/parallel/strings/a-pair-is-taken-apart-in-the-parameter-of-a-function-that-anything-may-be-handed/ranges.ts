import { keep, depth } from "./keep"
const A = 0x41
const B = 0x5a
const C = 0x5f
const E = 0x100
const F = 0x17f
const RADIX = 16
export const RANGES: readonly (readonly [number, number])[] = keep(Object.freeze([
  [A, B],
  [C, C],
  [E, F],
]), depth)
export const INNER = RANGES.map(
  ([low, high]) => `\\u{${low.toString(RADIX)}}` + (high > low ? `-\\u{${high.toString(RADIX)}}` : ""),
).join("")
export const ONE = new RegExp(`[${INNER}]`, "u")
