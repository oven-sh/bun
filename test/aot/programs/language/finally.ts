// `finally`: after normal completion, after an exception, on `return`, `break` and `continue`, and which completion overrides which.
let log = ""
function f(mode: number): string {
  try {
    log += "t"
    if (mode === 1) return "returned"
    if (mode === 2) throw new Error("thrown")
    log += "u"
  } finally {
    log += "f"
  }
  return "end"
}
console.log(f(0), f(1), log)
try { f(2) } catch (e) { console.log((e as Error).message, log) }
function g(): number { try { return 1 } finally { log += "G" } }
function h(): number { try { throw new Error("lost") } finally { return 2 } }
function k(): number { try { return 1 } finally { return 3 } }
console.log(g(), h(), k(), log)
let out = ""
for (let i = 0; i < 4; i++) {
  try {
    if (i === 1) continue
    if (i === 3) break
    out += "b" + i
  } finally {
    out += "f" + i
  }
}
console.log(out)
function both(n: number): string {
  let s = ""
  try {
    try { s += "a"; if (n) throw new Error("x"); s += "b" } catch (e) { s += "c"; if (n > 1) throw e } finally { s += "d" }
    s += "e"
  } catch { s += "g" } finally { s += "h" }
  return s
}
console.log(both(0), both(1), both(2))
outer: for (let i = 0; i < 3; i++) {
  inner: {
    for (let j = 0; j < 3; j++) {
      if (j === 1) break
      if (i === 1) break inner
      if (i === 2) break outer
      out += "|" + i + j
    }
    out += "+"
  }
}
console.log(out)
