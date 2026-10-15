// A boolean or number that is live into one `catch` block is passed through a function taking `unknown` and tested after a second `catch` block.
import { w3, w4 } from "./untyped-truth-tests-after-two-handlers.js";
declare const console: { log(...args: unknown[]): void }
let n = 0
export function yes(): boolean { let k = 0; for (let i = 0; i < 3; i++) k += ++n; return k > 0 }
export function count(): number { let k = 0; for (let i = 0; i < 3; i++) k += ++n; return k }
export function half(): number { return count() + 0.5 }
export function risky(x: unknown): number { if (x === 1) throw new Error("one"); return 2 }
function wide(a: unknown): unknown { return a }
function s6(x: unknown, y: unknown): string { const v = yes(); let s = ""; try { risky(x) } catch { s += "c1 " } const a = wide(v); try { risky(y) } catch { s += "c2 " } if (a) s += "T"; else s += "F"; return s }
function s7(x: unknown, y: unknown): string { const v = count(); let s = ""; try { risky(x) } catch { s += "c1 " } const a = wide(v); try { risky(y) } catch { s += "c2 " } if (a) s += "T"; else s += "F"; return s }
function s8(x: unknown, y: unknown): string { const v = half(); let s = ""; try { risky(x) } catch { s += "c1 " } const a = wide(v); try { risky(y) } catch { s += "c2 " } if (a) s += "T"; else s += "F"; return s }
function s9(x: unknown, y: unknown): string { const v = yes(); let s = ""; try { risky(x) } catch { s += "c1 " } const a = wide(v); for (let i = 0; i < 3; i++) { try { risky(i === 1 ? y : 0) } catch { s += "c" + i + " " } s += a ? "T" : "F" } while (a) { s += "W"; break } return s + (!a ? "F" : "T") }
function s10(x: unknown, y: unknown): string { const v = yes(); let s = ""; try { risky(x) } catch { s += "c1 " } const a = wide(v); try { try { risky(y) } finally { s += a ? "f" : "g" } } catch { s += "c2 " } return s + (a ? "T" : "F") }
for (const [label, f] of [["s6", s6], ["s7", s7], ["s8", s8], ["s9", s9], ["s10", s10], ["w3", w3], ["w4", w4]] as [string, (x: unknown, y: unknown) => string][])
  for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) console.log(label, x, y, f(x, y))
