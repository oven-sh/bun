// A function with `E extends Like<D>` replaces methods of the instance that it is given.
declare const console: { log(...values: unknown[]): void };
type Like<D> = { send(items: D[]): number; flush?(): Promise<void>; stop(): Promise<void> }
class Exporter {
  n = 0
  send(items: string[]): number { return items.length }
  async flush(): Promise<void> { this.n++; console.log('flush') }
  async stop(): Promise<void> { await this.flush(); console.log('stop') }
}
function wrap<D, E extends Like<D>>(x: E, _d: D[]): E {
  const e = x.send.bind(x)
  const f = x.flush?.bind(x)
  const s = x.stop.bind(x)
  x.send = items => e(items) + 100
  if (f) x.flush = async () => { await f(); console.log('after flush') }
  x.stop = async () => { await s(); console.log('after stop') }
  return x
}
class Owner { constructor(readonly e: Exporter) {} async end() { console.log(this.e.send(["a"])); await this.e.flush(); await this.e.stop() } }
try { await new Owner(wrap(new Exporter(), ["x"])).end() } catch (e) { console.log("THROWN: " + (e as Error).message) }
