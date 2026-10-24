// A declaration without a body says what a callback is called with; where it is wrong, the program gets slower but no TypeError is thrown. A type that the program itself writes on a parameter of the callback is tested on entry.
declare global {
  function callHost(callback: (count: number, item: { name: string }) => string): string
  function callWithThis(callback: (this: { id: number }, flag: boolean) => string): string
  function callTwice(make: () => (size: number) => string): string
  const host: {
    serve(options: { port: number; fetch(request: { url: string }, extra: number[]): { status: number }; hooks: { done: (code: number) => string }[] }): string
    onmessage: ((event: { data: string }) => string) | null
  }
}
const g = globalThis as any
g.callHost = (callback: any): any => callback("seven", 7)
g.callWithThis = (callback: any): any => callback.call("receiver", "flag")
g.callTwice = (make: any): any => make()("large")
g.host = { serve: (options: any): any => JSON.stringify(options.fetch(42, "extra")) + " " + options.hooks[0].done("code"), onmessage: null as unknown }

console.log(callHost((count, item) => typeof count + " " + typeof item + " " + count + item))
console.log(callHost((count, { name }) => typeof count + " " + name))
console.log(callHost((count = 1, ...rest) => count + " " + rest.length + " " + rest[0]))
console.log(callWithThis(function (flag) { return typeof this + " " + String(this) + " " + typeof flag + " " + (() => String(this))() }))
console.log(callTwice(() => size => typeof size + " " + size))
console.log(callTwice(() => { return size => typeof size }))
console.log(host.serve({ port: 1, fetch(request, extra) { return { status: typeof request === "number" ? 200 : 500, seen: typeof extra } as { status: number } }, hooks: [{ done: code => typeof code }] }))
host.onmessage = event => typeof event + " " + event
console.log(g.host.onmessage(false))
const kept = callHost((count, item) => { const copy = count; const other = item; return typeof copy + typeof other })
console.log(kept)

// The host keeps its word.
g.callHost = (callback: any): any => callback(7, { name: "seven" })
console.log(callHost((count, item) => count + 1 + item.name + item.name.length))

// JavaScriptCore implements these: facts.
console.log([3, 1, 2].sort((a, b) => a - b).map(n => n * 2).join())

// Annotated by the program, called by the host: the parameter with the written type is tested on entry, whoever calls. The one beside it without a written type is not.
g.callHost = (callback: any): any => callback("seven", 7)
try { console.log(callHost((count: number, item) => typeof count + " " + typeof item)) } catch (e) { console.log((e as Error).constructor.name) }

// Annotated by the program, called by the program: the same test.
const describe = (count: number) => typeof count
const values: any[] = ["seven"]
try { console.log(describe(values[0])) } catch (e) { console.log((e as Error).constructor.name) }
export {}
