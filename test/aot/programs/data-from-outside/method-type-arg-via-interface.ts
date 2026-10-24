// A method of a class passes a record type as an explicit type argument to a generic function through a method that is only known by its interface. Nothing in the program creates an object of that type, and the only cast is `as R` inside the generic function. Data from JSON.parse that matches the type must be accepted, as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
type Waiting = { resolve: (result: unknown) => void; reject: (error: unknown) => void }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; a = 5; b = 6; c = 7; d = 8 }
const unrelated = new Unrelated()
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.a + unrelated.b + unrelated.c + unrelated.d < 0) console.log('never')
const waiting = new Map<number, Waiting>()
const seen: unknown[] = []
let next = 0
function arrive(id: number, text: string): void {
  const entry = waiting.get(id)
  if (!entry) return
  waiting.delete(id)
  const parsed: unknown = JSON.parse(text)
  seen.push(parsed)
  entry.resolve(parsed)
}
function later<R>(text: string): Promise<R> {
  const id = next++
  Promise.resolve().then(() => arrive(id, text))
  return new Promise<R>((resolve, reject) => {
    waiting.set(id, { resolve: result => resolve(result as R), reject })
  })
}
interface Sender { send<R>(text: string): Promise<R> }
const sender: Sender = { send<R>(text: string): Promise<R> { return later<R>(text) } }
class Caller { async ask() { const answer = await sender.send<{ k: Part }>('{"k": {"id": 1}}'); return answer.k } }
console.log(JSON.stringify(await new Caller().ask()))
