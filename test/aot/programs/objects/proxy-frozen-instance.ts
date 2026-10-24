// Proxies over instances and literals that are frozen, sealed or have a read-only extra property: what a get or set trap answers is checked against the target exactly as in plain Bun.
class Point { x: number = 1; y: number = 2 }

class Forwarding {
  get(t: object, k: PropertyKey): unknown { return Reflect.get(t, k) }
  set(t: object, k: PropertyKey, v: unknown): boolean { return Reflect.set(t, k, v) }
}

function outcome(f: () => unknown): string {
  try {
    return String(f())
  } catch (e) {
    return "threw " + (e as Error).name
  }
}

const key = Symbol("key")

const targets: [string, () => object][] = [
  ["instance", () => new Point()],
  ["frozen instance", () => Object.freeze(new Point())],
  ["sealed instance", () => Object.seal(new Point())],
  ["instance with a read-only extra property", () => Object.defineProperty(new Point(), "extra", { value: 3 })],
  ["frozen instance with an indexed and a symbol property", () => { const o: any = new Point(); o[0] = 7; o[key] = 8; return Object.freeze(o) }],
  ["frozen literal", () => { const literal: { x: number } = { x: 1 }; return Object.freeze(literal) }],
]

const handlers: [string, ProxyHandler<object>][] = [
  ["x is 42", { get: (t, k) => k === "x" ? 42 : Reflect.get(t, k), set: () => true }],
  ["every name is 42", { get: () => 42, set: () => true }],
  ["truthful", { get: (t, k) => Reflect.get(t, k), set: (t, k, v) => Reflect.set(t, k, v) }],
  ["truthful, traps inherited from a class", new Forwarding()],
]

function sumOfY(p: any): number {
  let sum = 0
  for (let i = 0; i < 100; i++) sum += p.y
  return sum
}

for (const [handlerLabel, handler] of handlers) {
  for (const [label, createTarget] of targets) {
    const p: any = new Proxy(createTarget(), handler)
    console.log(handlerLabel + ", " + label + ": " + [
      outcome(() => p.x),
      outcome(() => p.y),
      outcome(() => p.extra),
      outcome(() => p.absent),
      outcome(() => p[0]),
      outcome(() => p[key]),
      outcome(() => { p.x = 9; return "stored" }),
      outcome(() => { p.x = 1; return "stored" }),
      outcome(() => { p[0] = 9; return "stored" }),
      outcome(() => { p[key] = 9; return "stored" }),
      outcome(() => sumOfY(p)),
    ].join(" | "))
  }
}

export {}
