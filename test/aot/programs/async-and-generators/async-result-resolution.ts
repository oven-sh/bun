// How an async function settles its promise for each kind of result, and the order of every callback. No class here has a method named `then`: async-result-class-thenable.ts has one.
const log: string[] = []
const say = (s: string) => { log.push(s) }

class Point {
  x: number
  constructor(x: number) { this.x = x }
}
class Size {
  width: number
  constructor(width: number) { this.width = width }
}

function pointWithThen(x: number): Point {
  const p = new Point(x)
  ;(p as any).then = (resolve: (v: string) => void) => { say("extra then"); resolve("adopted from extra property") }
  return p
}
function throwingThenable(): any {
  return { then() { say("throwing then"); throw new Error("thenable threw") } }
}
function describe(value: unknown): string {
  if (value instanceof Point) return "Point " + value.x
  if (value instanceof Size) return "Size " + value.width
  if (value instanceof Error) return "Error " + value.message
  return typeof value + " " + String(value)
}

async function returnNumber(): Promise<number> { return 1 }
async function returnString(): Promise<string> { return "text" }
async function returnUndefined(): Promise<undefined> { return undefined }
async function returnPoint(): Promise<Point> { return new Point(2) }
async function returnPointWithThen(): Promise<Point | string> { return pointWithThen(3) }
async function returnSize(): Promise<Size> { return new Size(5) }
async function returnPromise(): Promise<number> { return Promise.resolve(4) }
async function returnThrowingThenable(): Promise<number> { return throwingThenable() }
async function throwError(): Promise<number> { throw new Error("thrown") }

async function numberAfterAwait(): Promise<number> { await null; return 1 }
async function stringAfterAwait(): Promise<string> { await null; return "text" }
async function undefinedAfterAwait(): Promise<undefined> { await null; return undefined }
async function pointAfterAwait(): Promise<Point> { await null; return new Point(2) }
async function pointWithThenAfterAwait(): Promise<Point | string> { await null; return pointWithThen(3) }
async function sizeAfterAwait(): Promise<Size> { await null; return new Size(5) }
async function promiseAfterAwait(): Promise<number> { await null; return Promise.resolve(4) }
async function throwingThenableAfterAwait(): Promise<number> { await null; return throwingThenable() }
async function throwErrorAfterAwait(): Promise<number> { await null; throw new Error("thrown") }

const direct: [string, () => Promise<unknown>][] = [
  ["number", returnNumber],
  ["string", returnString],
  ["undefined", returnUndefined],
  ["point", returnPoint],
  ["point with then", returnPointWithThen],
  ["size", returnSize],
  ["promise", returnPromise],
  ["throwing thenable", returnThrowingThenable],
  ["throw", throwError],
]
const afterAwait: [string, () => Promise<unknown>][] = [
  ["number after await", numberAfterAwait],
  ["string after await", stringAfterAwait],
  ["undefined after await", undefinedAfterAwait],
  ["point after await", pointAfterAwait],
  ["point with then after await", pointWithThenAfterAwait],
  ["size after await", sizeAfterAwait],
  ["promise after await", promiseAfterAwait],
  ["throwing thenable after await", throwingThenableAfterAwait],
  ["throw after await", throwErrorAfterAwait],
]

function attach(name: string, promise: Promise<unknown>) {
  promise.then(v => say(name + " fulfilled: " + describe(v)), e => say(name + " rejected: " + describe(e)))
}

async function awaitedInLoop(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    say("loop " + i + " number " + (await returnNumber()))
    say("loop " + i + " string " + (await returnString()))
    say("loop " + i + " undefined " + (await returnUndefined()))
    say("loop " + i + " " + describe(await returnPoint()))
    say("loop " + i + " " + describe(await returnPointWithThen()))
    say("loop " + i + " " + describe(await returnSize()))
    say("loop " + i + " promise " + (await returnPromise()))
    say("loop " + i + " number after await " + (await numberAfterAwait()))
    say("loop " + i + " " + describe(await pointAfterAwait()))
    say("loop " + i + " " + describe(await pointWithThenAfterAwait()))
    say("loop " + i + " " + describe(await sizeAfterAwait()))
    try { await returnThrowingThenable() } catch (e) { say("loop " + i + " caught " + describe(e)) }
    try { await throwingThenableAfterAwait() } catch (e) { say("loop " + i + " caught " + describe(e)) }
    try { await throwError() } catch (e) { say("loop " + i + " caught " + describe(e)) }
    try { await throwErrorAfterAwait() } catch (e) { say("loop " + i + " caught " + describe(e)) }
  }
}

say("start")
Promise.resolve().then(() => say("tick 1")).then(() => say("tick 2")).then(() => say("tick 3")).then(() => say("tick 4")).then(() => say("tick 5"))
for (const [name, run] of direct) attach(name, run())
for (const [name, run] of afterAwait) attach(name, run())
for (const [name, run] of afterAwait) {
  const promise = run()
  attach("first reaction, " + name, promise)
  attach("second reaction, " + name, promise)
}
awaitedInLoop().then(() => say("loop done"))
say("end of script")
setTimeout(() => console.log(log.join("\n")), 0)
