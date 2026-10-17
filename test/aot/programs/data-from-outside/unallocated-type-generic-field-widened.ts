// No object of the record type is ever created: parsed data that matches it arrives from a field of a generic class that is typed by the type parameter. It is passed to a parameter whose type has one more optional member and is never created either. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
function later<R>(text: string): Promise<R> { return Promise.resolve(JSON.parse(text) as R) }
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
function use(given: { k: Part; j?: number }): Part { return given.k }
class Box<R> { value: R | undefined; fill(text: string): void { this.value = JSON.parse(text) as R } }
async function ask() { const box = new Box<{ k: Part }>(); box.fill('{"k": {"id": 1}}'); const answer = box.value!; return use(answer) }
console.log(JSON.stringify(await ask()))
