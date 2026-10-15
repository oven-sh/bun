// One generic type, two instantiations: a record is made at `Routed<T>` and taken as `Routed<unknown>`, both ways by a call by value.
// Somewhere else in the program parsed data is held to the generic one.
type G<T> = { body: T; code: number }
type W = { w: number }
type Result<T> = { ok: true; data: T; status: number; reply: G<T>; mark?: null | string } | { ok: false; reason: "a" } | { ok: false; reason: "b" } | { ok: false; reason: "c"; detail: string }
type Routed<T> = Result<T> & { route: "direct" | "far"; fromFar: boolean; a?: number; b?: W; c?: number; d?: "x" | "y"; e?: number }
const bag: unknown[] = []
function travel(x: unknown): any { bag.push(x); return bag.pop() }
function make<T>(x: T): Result<T> { return typeof x === "boolean" ? { ok: true, data: x, status: 201.5, reply: { body: x, code: 2 }, mark: "m" } : { ok: true, data: x, status: 200.5, reply: { body: x, code: 1 } } }
async function direct<T>(x: T): Promise<Result<T>> { return x === null ? { ok: false, reason: "a" } : make<T>(x) }
async function send<T>(x: T): Promise<Routed<T>> {
  const sendDirect = async (): Promise<Routed<T>> => ({ ...(await direct<T>(x)), route: "direct", fromFar: true })
  const sendFar = async (): Promise<Routed<T>> => ({ ...(await direct<T>(x)), route: "far", fromFar: false, a: 1.5, b: { w: 2 }, c: 3.5, d: "x", e: 5.5 })
  const replayed = async (): Promise<Routed<T>> => travel(JSON.parse('{"ok":true,"data":4,"status":1.5,"reply":{"body":4,"code":3},"route":"far","fromFar":true}'))
  return typeof x === "string" ? sendFar() : typeof x === "symbol" ? replayed() : sendDirect()
}
type Taker = (res: Routed<unknown>) => string
const takers: Taker[] = []
takers.push(res => {
  if (!res.ok) return "not ok " + res.reason
  if (!res.fromFar) return "near " + res.a
  return res.status + " " + res.route + " " + JSON.stringify(res.data) + " " + res.reply.code + " " + (res.mark ?? "-") + (res.a ?? "-")
})
const senders: Record<string, <T>(x: T) => Promise<Routed<T>>> = { send }
async function use(x: unknown) {
  let res: Routed<unknown>
  res = await senders.send!<unknown>(x)
  return takers.map(take => take(res)).join()
}
try { console.log("a boolean: " + await use(true)) } catch (e) { console.log("a boolean: " + (e instanceof TypeError ? "TypeError" : "other " + e)) }
