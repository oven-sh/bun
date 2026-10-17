// A promise of `{ answer: Msg }`, Msg a union of two records, is resolved with parsed JSON.
declare const console: { log(...values: unknown[]): void };
type Req = { jsonrpc: '2.0'; id: number | string; method: string; params?: Record<string, unknown> }
type Res = { jsonrpc: '2.0'; id: number | string; result: Record<string, unknown> }
type Msg = Req | Res
type Wrapped = { answer: Msg }
function local(id: number): Wrapped { return { answer: { jsonrpc: '2.0', id, result: {} } } }
class IO {
  private waiting = new Map<number, { resolve: (v: unknown) => void }>()
  send<T>(id: number): Promise<T> { return new Promise<T>(resolve => { this.waiting.set(id, { resolve: resolve as (v: unknown) => void }) }) }
  got(line: string) { const m = JSON.parse(line) as { id: number; response: unknown }; this.waiting.get(m.id)!.resolve(m.response) }
  async ask(id: number): Promise<Msg> { const r = await this.send<{ answer: Msg }>(id); return r.answer }
}
const io = new IO()
console.log(JSON.stringify(local(1)))
const p = io.ask(1).then(JSON.stringify, e => 'THROWN: ' + e.message)
io.got('{"id":1,"response":{"answer":{"jsonrpc":"2.0","id":7,"result":{"tools":[]}}}}')
console.log(await p)
