// Where the type of a place that can be stored to is inferred from an expression, code that a build-time constant cuts still says what the place may hold. Each store below fits the type TypeScript infers, so it must neither stop the build nor throw.
// Flags: --define INTERNAL=false
// Reference: bun build --compile
declare const INTERNAL: boolean
const log: unknown[] = []
function useState<S>(initial: S): [() => S, (next: S) => void] {
  let held = initial
  return [() => held, next => void (held = next)]
}
function parse(text: string): any {
  return JSON.parse(text)
}

const [state, setState] = useState(INTERNAL ? { a: 1 } : null)
log.push(state())
setState({ a: 2 })
log.push(state()?.a)
setState(parse('{"a":3}'))
log.push(state()?.a)

let either = INTERNAL ? 1 : "text"
log.push(either)
either = 2
log.push(either)
either = parse("3")
log.push(either)

const list = [1, ...(INTERNAL ? ["x"] : [])]
list.push("y")
log.push(list.join())

const handlers = { onEvent: INTERNAL ? (n: number) => n : undefined }
log.push(typeof handlers.onEvent)
handlers.onEvent = n => n + 1
log.push(handlers.onEvent(1))

const initial = INTERNAL ? { a: 1 } : null
const [second, setSecond] = useState(initial)
setSecond({ a: 4 })
log.push(second()?.a)
const boxes = [initial]
boxes.push({ a: 5 })
log.push(boxes.length, boxes[1]?.a)

const config = INTERNAL ? { a: 1, internal: 2 } : { a: 1 }
log.push(config.a, config.internal)

function pick() {
  if (INTERNAL) return { kind: "internal" as const, extra: 1 }
  return { kind: "public" as const }
}
const picked = pick()
if (picked.kind === "internal") log.push(picked.extra)
switch (picked.kind) {
  case "internal":
    log.push("never")
    break
  case "public":
    log.push("public")
}

let client: { send(): string } | null = null
if (INTERNAL) client = { send: () => "sent" }
if (client) log.push(client.send())
function later(): string {
  return client ? client.send() : "no client"
}
log.push(later())

type Loaded = { g(n: number): number; extra: { a: number } }
function load(): Loaded {
  return { g: n => n, extra: { a: 1 } }
}
const internalModule = INTERNAL ? load() : null
const g = INTERNAL ? internalModule?.g : undefined
const callsG = (n: number) => g!(n)
function take(o: { a?: number; b: number }) {
  return o.b
}
const options = INTERNAL ? internalModule?.extra : undefined
log.push(typeof callsG, take({ b: 1, ...(INTERNAL ? internalModule?.extra : {}) }), take({ b: 2, ...options }))

const annotated: { a: number } | undefined = INTERNAL ? { a: 1 } : undefined
log.push(take({ b: 3, ...annotated }))
let stored: { a: number } | undefined
stored = INTERNAL ? { a: 1 } : undefined
log.push(take({ b: 4, ...stored }))
function extra() {
  if (INTERNAL) return { a: 1 }
  return undefined
}
let merged: { a?: number; b: number }
merged = { b: 5, ...(log.length > 0 && extra()) }
log.push(merged.b)

const loaded = INTERNAL ? { run: (n: number) => n, names: ["a"] } : null
log.push(loaded?.run(1), loaded?.names.map(name => name.length), [...(loaded?.names ?? [])].length)
console.log(log.map(String).join("\n"))
