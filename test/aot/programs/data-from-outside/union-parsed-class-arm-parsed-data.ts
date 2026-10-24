// A union of four records. Parsed data is held to it in one place; in another a record is made for it by a spread.
// One arm holds an object of a class; the other three hold data alone.
class Reply<T> { constructor(public body: T, public code: number) {} text() { return String(this.code) } }
type W = { w: number }
type Result<T> = { ok: true; data: T; status: number; reply: Reply<T>; mark?: null | string } | { ok: false; reason: "a" } | { ok: false; reason: "b" } | { ok: false; reason: "c"; detail: string }
type Routed<T> = Result<T> & { route: "direct" | "far"; fromFar: boolean; a?: number; b?: W; c?: number; d?: "x" | "y"; e?: number }
const bag: unknown[] = []
function travel(x: unknown): any { bag.push(x); return bag.pop() }
function make<T>(x: T): Result<T> { return typeof x === "boolean" ? { ok: true, data: x, status: 201.5, reply: new Reply(x, 2), mark: "m" } : { ok: true, data: x, status: 200.5, reply: new Reply(x, 1) } }
async function direct<T>(x: T): Promise<Result<T>> { return x === null ? { ok: false, reason: "a" } : x === undefined ? { ok: false, reason: "c", detail: "none" } : make<T>(x) }
function client() {
  return {
    get: async <T,>(x: T): Promise<Routed<T>> => {
      const sendDirect = async (): Promise<Routed<T>> => ({ ...(await direct<T>(x)), route: "direct", fromFar: true })
      const sendFar = async (): Promise<Routed<T>> => ({ ...(await direct<T>(x)), route: "far", fromFar: false, a: 1.5, b: { w: 2 }, c: 3.5, d: "x", e: 5.5 })
      return typeof x === "string" ? sendFar() : sendDirect()
    },
  }
}
const api = client()
async function use(x: unknown) {
  let res: Routed<unknown>
  res = await api.get<unknown>(x)
  if (!res.ok) return "not ok " + res.reason
  if (!res.fromFar) return "near " + res.a
  return res.status + " " + res.route + " " + JSON.stringify(res.data) + " " + res.reply.text() + " " + (res.mark ?? "-") + (res.a ?? "-")
}
function replayed(text: string) {
  const boot: Routed<unknown> = travel(JSON.parse(text))
  return boot.ok ? "ok" : boot.reason === "c" ? boot.reason + boot.detail + boot.route : boot.reason + boot.route
}
try { console.log("parsed data: " + replayed('{"ok":false,"reason":"c","detail":"d","route":"far","fromFar":false}')) } catch (e) { console.log("parsed data: " + (e instanceof TypeError ? "TypeError" : "other " + e)) }
