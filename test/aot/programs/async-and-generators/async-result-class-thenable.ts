// An async function that returns an object whose class has a `then` method adopts it. A typed object without one, in the same program, is still handed over as a value.
const log: string[] = []
const say = (s: string) => { log.push(s) }

class Point {
  x: number
  constructor(x: number) { this.x = x }
}
class HasThen {
  then(resolve: (v: string) => void) { say("HasThen.then"); resolve("adopted from class") }
}

function describe(value: unknown): string {
  if (value instanceof Point) return "Point " + value.x
  if (value instanceof HasThen) return "HasThen was not adopted"
  return typeof value + " " + String(value)
}

async function returnPoint(): Promise<Point> { return new Point(2) }
async function returnHasThen(): Promise<string> { return new HasThen() as any }
async function pointAfterAwait(): Promise<Point> { await null; return new Point(2) }
async function hasThenAfterAwait(): Promise<string> { await null; return new HasThen() as any }

const cases: [string, () => Promise<unknown>][] = [
  ["point", returnPoint],
  ["has then", returnHasThen],
  ["point after await", pointAfterAwait],
  ["has then after await", hasThenAfterAwait],
]

function attach(name: string, promise: Promise<unknown>) {
  promise.then(v => say(name + " fulfilled: " + describe(v)), e => say(name + " rejected: " + describe(e)))
}

async function awaitedInLoop(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    say("loop " + i + " " + describe(await returnPoint()))
    say("loop " + i + " " + describe(await returnHasThen()))
    say("loop " + i + " " + describe(await pointAfterAwait()))
    say("loop " + i + " " + describe(await hasThenAfterAwait()))
  }
}

say("start")
Promise.resolve().then(() => say("tick 1")).then(() => say("tick 2")).then(() => say("tick 3")).then(() => say("tick 4")).then(() => say("tick 5"))
for (const [name, run] of cases) attach(name, run())
for (const [name, run] of cases) {
  const promise = run()
  attach("first reaction, " + name, promise)
  attach("second reaction, " + name, promise)
}
awaitedInLoop().then(() => say("loop done"))
say("end of script")
setTimeout(() => console.log(log.join("\n")), 0)
