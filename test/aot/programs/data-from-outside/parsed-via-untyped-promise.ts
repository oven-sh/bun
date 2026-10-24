// Parsed data that travels as `any` or `unknown` before a typed function first holds it, some of its optional members absent: queues,
// caches, event buses. The type has more than six members.
interface Meta { source: string; hops: number; a?: number; b?: number; c?: number; d?: number; e?: number; f?: number; g?: number }
interface Message {
  id: number; at: number; size: number; weight: number; body: string
  meta?: Meta; retries?: number; delay?: number; sentAt?: number; score?: number; tags?: string[]
}
type Wide = { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h?: Message }
const line = '{"id":1,"at":0.5,"size":2.5,"weight":3.5,"body":"hello"}'
const withMeta = '{"id":2,"at":0.5,"size":2.5,"weight":3.5,"body":"hi","meta":{"source":"wire","hops":2},"tags":["x","y"]}'
function handle(m: Message) {
  return m.id + m.at + m.size + m.weight + m.body + (m.retries ?? 0) + (m.delay ?? "-") + (m.score ?? "") + (m.meta ? m.meta.source + m.meta.hops + (m.meta.a ?? "") : "") + (m.tags ? m.tags.length : "")
}
const made: Message = { id: 9, at: 1.5, size: 2.5, weight: 3.5, body: "z", retries: 3.5, delay: 0.5, sentAt: 4.5, score: 0.25, tags: [], meta: { source: "own", hops: 0.5, a: 1.5, b: 2.5, c: 3.5, d: 4.5, e: 5.5, f: 6.5, g: 7.5 } }
function row(name: string, f: () => unknown) {
  try { const value = f(); if (value instanceof Promise) value.then(v => console.log(name + ": " + v), e => console.log(name + ": rejected " + (e instanceof TypeError ? "TypeError" : e))); else console.log(name + ": " + value) }
  catch (e) { console.log(name + ": " + (e instanceof TypeError ? "TypeError" : "other " + e)) }
}
row("made by the program", () => handle(made))
row("a promise", async () => { const m: any = await Promise.resolve(JSON.parse(line)); return handle(m) })
