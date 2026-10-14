// Async generators and `for await`.
const log: string[] = []
const say = (s: string) => { log.push(s) }
const later = <T,>(v: T): Promise<T> => new Promise(resolve => resolve(v))
async function* count(n: number): AsyncGenerator<number, string, unknown> { for (let i = 0; i < n; i++) { say("before " + i); yield await later(i); say("after " + i) } return "finished" }
async function* guarded(): AsyncGenerator<number, string, unknown> { try { yield 1; yield 2; return "end" } catch (e) { say("caught " + e); yield 99; return "recovered" } finally { say("cleanup"); await later(0); say("cleaned") } }
async function* outer(): AsyncGenerator<number | string> { const r = yield* count(2); yield r; yield* [7, Promise.resolve(8)]; yield* guarded() }
function* sync() { yield 1; yield Promise.resolve(2); yield 3 }
async function main(): Promise<void> {
  let total = 0
  for await (const n of count(3)) total += n
  say("total " + total)
  for await (const n of guarded()) { say("got " + n); if (n === 1) break }
  try { for await (const n of guarded()) { say("got " + n); throw new Error("body") } } catch (e) { say((e as Error).message) }
  for await (const v of sync()) say("sync " + v)
  for await (const v of [later("a"), "b"]) say("array " + v)
  const all: (number | string)[] = []
  for await (const v of outer()) all.push(v)
  say(all.join())
  const g = count(2)
  const queued = [g.next(), g.next(), g.next(), g.next()]
  say(JSON.stringify(await Promise.all(queued)))
  const h = guarded(); await h.next()
  say(JSON.stringify(await h.throw("boom")) + JSON.stringify(await h.next()) + JSON.stringify(await h.next()))
  const r = guarded(); await r.next()
  say(JSON.stringify(await r.return("early")) + JSON.stringify(await r.return(later("again"))))
  const unstarted = guarded()
  say(JSON.stringify(await unstarted.return("never")) + " " + Object.prototype.toString.call(unstarted) + " " + (unstarted[Symbol.asyncIterator]() === unstarted))
  try { await guarded().throw(new Error("unstarted")) } catch (e) { say((e as Error).message) }
}
function old() { return arguments.length + ":" + Array.prototype.join.call(arguments, "-") + ":" + typeof arguments + ":" + Object.prototype.toString.call(arguments) }
function named(a: number, b = 5) { return a + b + arguments.length }
function viaArrow(this: unknown, a: number) { const inner = () => () => arguments.length + ":" + arguments[1] + ":" + a; return inner()() }
function withRest(first: number, ...others: number[]) { return arguments.length + ":" + first + ":" + others.join("+") }
say((viaArrow as any)(1, "second") + " " + withRest(1, 2, 3) + " " + withRest(9))
say((old as any)(1, "two", 3) + " " + (old as any)() + " " + named(1) + " " + named(1, 2))
main().then(() => console.log(log.join("\n")), e => console.log("failed", e, log.join("\n")))
