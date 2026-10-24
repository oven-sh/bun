// A generic function returns Promise<R> and none of its parameters mention R, so only the caller's claim determines R. The type argument is a tagged union of two aliases. The program must behave as in plain Bun.
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
type Ok = { ok: true; k: Part }
type No = { ok: false; e: string }
async function ask() { const answer = await later<Ok | No>('{"ok": true, "k": {"id": 1}}'); return answer.ok ? answer.k : answer.e }
console.log(JSON.stringify(await ask()))
