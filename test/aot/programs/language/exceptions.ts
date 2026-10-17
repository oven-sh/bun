// Exceptions thrown locally, by called functions and by built-in functions, and which values are live in and after the `catch` block.
function risky(n: number): number { if (n % 3 === 0) throw new Error("bad " + n); return n * 2 }
function guarded(n: number): string {
  let before = n + 100
  let steps = 0
  try {
    steps = 1
    const r = risky(n)
    steps = 2
    before += r
    return "ok " + r + " " + before + " " + steps
  } catch (e) {
    return "caught " + (e as Error).message + " " + before + " " + steps
  }
}
console.log(guarded(1), "|", guarded(3), "|", guarded(4), "|", guarded(6))
function nested(n: number): string {
  let log = ""
  try {
    log += "a"
    try {
      log += "b"
      risky(n)
      log += "c"
    } catch (inner) {
      log += "d"
      if (n === 6) throw new Error("again")
      log += "e"
    }
    log += "f"
  } catch (outer) {
    log += "g" + (outer as Error).message
  }
  return log
}
console.log(nested(1), nested(3), nested(6))
let total = 0.5
let count = 0
for (let i = 0; i < 20; i++) {
  try { total += risky(i) } catch { count++ }
}
console.log(total, count)
function fromEngine(text: string): string {
  try { return "parsed " + JSON.parse(text).a } catch (e) { return "not JSON: " + (e instanceof SyntaxError) }
}
console.log(fromEngine('{"a":5}'), fromEngine("{"))
function thrower(x: unknown): never { throw x }
for (const value of [1, "s", null, undefined, 2.5, true]) {
  try { thrower(value) } catch (e) { console.log(typeof e, e) }
}
const nothing: any = null
try { console.log(nothing.x) } catch (e) { console.log("TypeError", e instanceof TypeError) }
