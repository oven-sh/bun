// Closures stored in typed fields at creation, which may be made only when first read. Evaluated text redefines, replaces, hides and re-creates the fields with functions of the
// declared type, before and after the first read, and typed code calls them.
function outcome(f: () => unknown): string { try { const v = f(); return typeof v === "function" ? "function " + v.name : JSON.stringify(v) ?? "undefined" } catch (e) { return "throws " + (e as Error).name } }
function show(label: string, ...parts: unknown[]): void { console.log(label + ": " + parts.map(String).join(" | ")) }

class Reader {
  count = 0
  onData = () => ++this.count
  onEnd: () => number
  onError = () => -1
  constructor(public id: number) { this.onEnd = () => this.count + this.id }
  run(): number { return this.onData() + this.onEnd() + this.onError() }
}
type Handlers = { id: number, read: () => number, plain: () => number, maybe?: () => number }
function makeHandlers(id: number): Handlers { const o: Handlers = { id, read: () => o.id + 1, plain: () => 7 }; return o }

const text: any = (0, eval)(`({
  accessor(o, k) { Object.defineProperty(o, k, { get() { const id = this.id; return () => id * 1000; }, enumerable: true, configurable: true }); },
  accessorAndSetter(o, k) { let f = () => 4000; Object.defineProperty(o, k, { get() { return f; }, set(v) { f = v; }, enumerable: true, configurable: true }); },
  hidden(o, k) { Object.defineProperty(o, k, { enumerable: false }); },
  readOnly(o, k) { Object.defineProperty(o, k, { writable: false }); },
  other(o, k) { o[k] = function other() { return 100; }; },
  bound(o, k) { o[k] = Math.abs.bind(null, -6); },
  removeAndAdd(o, k) { delete o[k]; o[k] = function again() { return 200; }; },
  defined(o, k) { Object.defineProperty(o, k, { value: () => 500, writable: true, enumerable: true, configurable: true }); },
  frozen(o, k) { Object.freeze(o); },
  call(o, k) { return o[k](); },
})`)

function useReader(r: Reader): string { return [outcome(() => r.onData), r.onData(), r.onEnd(), r.onError(), r.run(), r.count, r.id].join(" ") }
function useHandlers(h: Handlers): string { return [outcome(() => h.read), h.read(), h.plain(), h.maybe?.(), h.id].join(" ") }
function replaceTyped(r: Reader, h: Handlers): string { return outcome(() => { r.onData = () => 50; r.onError = r.onEnd; h.plain = h.read; h.maybe = () => 3; return "replaced" }) }
function seen(o: any): string { return [Reflect.ownKeys(o).join(), Object.keys(o).join(), JSON.stringify(o), Object.keys({ ...o }).join(), Object.entries(o).map(([k, v]) => k + "=" + typeof v).join()].join(" ; ") }

for (const name of Object.keys(text)) {
  if (name === "call") continue
  for (const readFirst of [false, true]) {
    for (const [readerKey, handlersKey] of [["onData", "read"], ["onEnd", "plain"], ["onError", "read"]] as const) {
      const r = new Reader(10)
      const h = makeHandlers(10)
      const kept = readFirst ? [r[readerKey], h[handlersKey]] : []
      text[name](r, readerKey)
      text[name](h, handlersKey)
      show([name, readerKey, handlersKey, readFirst ? "read first" : "never read"].join(", "), outcome(() => useReader(r)), useHandlers(h), seen(r), seen(h), outcome(() => text.call(r, readerKey)), outcome(() => text.call(h, handlersKey)),
        outcome(() => kept.map(f => f()).join()), kept.length ? kept[0] === r[readerKey] : "-", replaceTyped(r, h), outcome(() => useReader(r)), useHandlers(h), seen(h))
    }
  }
}

{
  const h = makeHandlers(1)
  h.maybe = () => 3
  const before = useHandlers(h)
  delete h.maybe
  show("typed delete", before, useHandlers(h), seen(h))
}
export {}
