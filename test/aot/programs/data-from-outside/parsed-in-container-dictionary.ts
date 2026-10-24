// Parsed data that travels as `any` and first meets its type inside a container, or below a value that has met its type.
// The type has more than six members; the type of one of its members has two.
interface Origin { source: string; hops: number }
interface Message {
  id: number; at: number; size: number; weight: number; body: string
  origin?: Origin; retries?: number; delay?: number; sentAt?: number; score?: number; tags?: string[]
}
interface Batch { name: string; items: Message[] }
const line = '{"id":1,"at":0.5,"size":2.5,"weight":3.5,"body":"hello"}'
const withOrigin = '{"id":2,"at":0.5,"size":2.5,"weight":3.5,"body":"hi","origin":{"source":"wire","hops":2},"tags":["x","y"]}'
const bag: unknown[] = []
function travel(x: unknown): any { bag.push(x); return bag.pop() }
function own(n: number): Message { return { id: n, at: 1.5, size: 2.5, weight: 3.5, body: "own", retries: n, delay: 0.5, sentAt: 4.5, score: 0.25, tags: ["o"], origin: { source: "own", hops: 1 } } }
function handle(m: Message) {
  return m.id + m.at + m.size + m.weight + m.body + (m.retries ?? 0) + (m.delay ?? "-") + (m.score ?? "") + (m.origin ? m.origin.source + m.origin.hops : "") + (m.tags ? m.tags.length : "")
}
const made = own(9)
function row(name: string, f: () => unknown) {
  try { console.log(name + ": " + f()) } catch (e) { console.log(name + ": " + (e instanceof TypeError ? "TypeError" : "other " + e)) }
}
row("made by the program", () => handle(made))
row("a dictionary", () => { const byId: Record<string, Message> = travel(JSON.parse('{"k":' + line + "}")); byId.own = own(1); return handle(byId.k!) + handle(byId.own!) })
