// Module namespace exports are sorted and looked up by UTF-16 code unit, an order that differs from UTF-8 byte order above U+FFFF.
import * as own from "./namespace-non-ascii-exports.ts"
import { "\u{1F600}" as grin, 𝐀 as bold } from "./namespace-non-ascii-exports.ts"
function said(f: () => unknown): string { try { return String(f()) } catch (e) { return "threw " + (e as Error).name } }

export const a = 1, z = 2, A = 4, _ = 8, $ = 16, é = 32, Ａ = 64, ｚ = 128, 𝐀 = 256, 𠮷 = 512, xＡ = 1024, x𝐀 = 2048, x𝐀b = 4096, xＡb = 8192
export function ｆ() { return 16384 }
export default 32768
const emoji = 65536, replacement = 131072, privateUse = 262144
export { emoji as "\u{1F600}", replacement as "\uFFFD", privateUse as "\uE000" }

const ns: any = own
const listed = Object.keys(ns)
const units = (s: string) => Array.from({ length: s.length }, (_v, i) => s.charCodeAt(i).toString(16)).join(".")
const enumerated: string[] = []
for (const key in ns) enumerated.push(key)
console.log(listed.map(units).join(" "))
console.log(
  listed.join() === [...listed].sort().join(),
  listed.length,
  Object.getOwnPropertyNames(ns).join() === listed.join(),
  enumerated.join() === listed.join(),
  Object.keys({ ...ns }).join() === listed.join(),
  Reflect.ownKeys(ns).filter(k => typeof k === "string").join() === listed.join(),
)
console.log(JSON.stringify(ns))

for (const key of listed) {
  const value = ns[key]
  console.log(units(key), typeof value === "function" ? value() : value, key in ns, Object.hasOwn(ns, key), Reflect.has(ns, key))
}
for (const key of ["", "B", "è", "ê", "Ｂ", "＠", "\u{1D401}", "\u{1D3FF}", "x", "x𝐀a", "xＡa", "\uD835", "\uDC00", "\uD842", "\uFFFF", "\u{1F601}", "aa", "default ", "ａ"]) {
  console.log("absent", units(key), ns[key], key in ns)
}

console.log(own.Ａ + own.𝐀 + own.𠮷 + own.x𝐀b + own.xＡ + own.ｆ() + own.default + grin + bold)
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(ns, "𝐀")), said(() => { ns["𝐀"] = 0 }), Object.isSealed(ns), Object.isFrozen(ns), ns[Symbol.toStringTag])
import("./namespace-non-ascii-exports.ts").then(again => console.log(again === own))
