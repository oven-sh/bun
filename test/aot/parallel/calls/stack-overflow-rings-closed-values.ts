// A ring of calls that is closed only by a way in that is no direct call: a function held in a value, an accessor, a constructor in a variable, a bound function, a callback
// that a built-in function calls. Each ends in a RangeError that can be caught, with deep chains of small functions between two such entries, and the program goes on.
let entered = 0
function attempt(name: string, run: () => number) {
  entered = 0
  let outcome: string
  try { outcome = "returned " + run() } catch (error) { outcome = error instanceof RangeError ? "RangeError" : "another error: " + error }
  console.log(name + ": " + outcome + ", went deep: " + (entered > 1000))
}
type Step = (n: number) => number
const launder = new Function("v", "return v") as <V>(v: V) => V

function d1(n: number, f: Step): number { return d2(n + 1, f) + 1 } function d2(n: number, f: Step): number { return d3(n + 1, f) + 1 }
function d3(n: number, f: Step): number { return d4(n + 1, f) + 1 } function d4(n: number, f: Step): number { return d5(n + 1, f) + 1 }
function d5(n: number, f: Step): number { return d6(n + 1, f) + 1 } function d6(n: number, f: Step): number { return d7(n + 1, f) + 1 }
function d7(n: number, f: Step): number { entered++; return f(n + 1) + 1 }

const holder: { step: Step } = { step: n => n }
function throughField(n: number): number { return d1(n, holder.step) }
holder.step = throughField

const steps: Step[] = []
function throughArray(n: number): number { return d1(n, steps[n & 1]) }
steps.push(throughArray, n => throughArray(n + 1))

const unseen: { step: Step } = launder({ step: (n: number) => n })
function throughUnseen(n: number): number { return d1(n, unseen.step) }
unseen.step = throughUnseen

class Lazy {
  depth = 0
  get next(): number { entered++; this.depth++; return d1(this.depth, () => this.next) }
  set deeper(n: number) { entered++; d1(n, m => { this.deeper = m; return m }) }
}

class Nested {
  inner: Nested | undefined
  constructor(n: number) { entered++; this.inner = d1(n, m => new made(m).inner ? 1 : 0) ? undefined : undefined }
}
const made: typeof Nested = launder(Nested)

const target = { base: 1, run(n: number): number { return d1(n + this.base, bound) } }
const bound: Step = target.run.bind(target)

function throughMap(n: number): number { return d1(n, m => [m].map(throughMap)[0]) }
function throughSort(n: number): number { return d1(n, m => [m, m + 1].sort((a, b) => throughSort(a + b))[0]) }
function throughReplace(n: number): number { return d1(n, m => "x".replace("x", () => String(throughReplace(m))).length) }
function throughApply(n: number): number { return d1(n, m => Reflect.apply(throughApply, undefined, [m])) }
function throughCall(n: number): number { return d1(n, m => throughCall.call(undefined, m)) }
function throughToString(n: number): number { return d1(n, m => `${{ toString() { return String(throughToString(m)) } }}`.length) }
function throughProxy(n: number): number { return d1(n, m => proxied(m)) }
const proxied: Step = new Proxy(throughProxy, {})
function* values(n: number): Generator<number> { yield d1(n, m => [...values(m)][0]) }

attempt("a function in a field", () => throughField(0))
attempt("functions in an array", () => throughArray(0))
attempt("a function in an object that unseen code has had", () => throughUnseen(0))
attempt("a getter", () => new Lazy().next)
attempt("a setter", () => { new Lazy().deeper = 1; return 0 })
attempt("a constructor in a variable", () => new made(0).inner ? 1 : 0)
attempt("a bound function", () => bound(0))
attempt("Array.prototype.map", () => throughMap(0))
attempt("Array.prototype.sort", () => throughSort(0))
attempt("String.prototype.replace", () => throughReplace(0))
attempt("Reflect.apply", () => throughApply(0))
attempt("Function.prototype.call", () => throughCall(0))
attempt("toString", () => throughToString(0))
attempt("a proxy", () => throughProxy(0))
attempt("a generator", () => [...values(0)][0])

function nearTheEnd(n: number, f: Step): number {
  try { return nearTheEnd(n + 1, f) } catch { return d1(n, f) > 0 ? 1 : 0 }
}
attempt("seven small functions and a call of a value where the stack has just run out", () => { entered = 2000; let sum = 0; try { sum = nearTheEnd(0, m => m) } catch (error) { if (!(error instanceof RangeError)) throw error; sum = 1 } return sum })
attempt("and again afterwards", () => throughField(0))
console.log("done", d1(0, n => n))
