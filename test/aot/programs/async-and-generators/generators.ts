// Generators: yielded and sent values, `throw` and `return` with `finally`, delegation with `yield*`, and consumers of every kind.
function* count(from: number, to: number): Generator<number, string, unknown> { for (let i = from; i < to; i++) yield i; return "done" }
console.log([...count(0, 4)].join(), Array.from(count(2, 5)).join())
let total = 0
for (const n of count(0, 10)) { if (n === 7) break; total += n }
console.log(total)
const it = count(0, 2)
console.log(JSON.stringify([it.next(), it.next(), it.next(), it.next()]), it[Symbol.iterator]() === it, Object.prototype.toString.call(it))
function* echo(): Generator<string, number, number> { let sum = 0; let got = yield "first"; while (got !== 0) { sum += got; got = yield "sum " + sum } return sum }
const e = echo()
console.log(e.next(100).value, e.next(1).value, e.next(2).value, JSON.stringify(e.next(0)))
const log: string[] = []
function* guarded(): Generator<number, string, unknown> {
  try { log.push("in"); yield 1; yield 2; return "end" } catch (error) { log.push("caught " + error); yield 99; return "recovered" } finally { log.push("finally") }
}
const g1 = guarded(); g1.next(); console.log(JSON.stringify(g1.return("early")), JSON.stringify(g1.next()), log.join())
log.length = 0
const g2 = guarded(); g2.next(); console.log(JSON.stringify(g2.throw("boom")), JSON.stringify(g2.next()), log.join())
log.length = 0
const g3 = guarded(); console.log(JSON.stringify(g3.return("unstarted")), log.length)
const g4 = guarded(); try { g4.throw(new Error("unstarted")) } catch (error) { console.log((error as Error).message, JSON.stringify(g4.next())) }
function* outer(): Generator<number | string, string, unknown> { const r = yield* count(0, 2); yield r; yield* [7, 8]; yield* "ab"; return "outer " + (yield* guarded()) }
console.log([...outer()].join())
const o = outer(); o.next(); console.log(JSON.stringify(o.return("stop")), JSON.stringify(o.next()))
function* fib(): Generator<number> { let [a, b] = [0, 1]; for (;;) { yield a; [a, b] = [b, a + b] } }
const [f0, f1, f2, , f4] = fib()
console.log(f0, f1, f2, f4)
class Tree { constructor(public value: number, public kids: Tree[] = []) {} *[Symbol.iterator](): Generator<number> { yield this.value; for (const kid of this.kids) yield* kid } *walk(depth = 0): Generator<string> { yield depth + ":" + this.value; for (const kid of this.kids) yield* kid.walk(depth + 1) } }
const tree = new Tree(1, [new Tree(2, [new Tree(3)]), new Tree(4)])
console.log([...tree].join(), [...tree.walk()].join(), Math.max(...tree))
function* reentrant(): Generator<number> { yield 1; try { self.next() } catch (error) { yield (error as Error) instanceof TypeError ? 2 : 3 } }
const self = reentrant(); console.log(self.next().value, self.next().value)
const lazy = { *[Symbol.iterator]() { yield "x"; yield "y" } }
console.log([...lazy].join(""), new Map(function* () { yield ["k", 1] as [string, number] }()).get("k"))
