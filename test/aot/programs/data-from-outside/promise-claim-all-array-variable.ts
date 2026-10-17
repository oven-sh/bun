// `later<R>(text): Promise<R>` resolves to parsed data, and R is only what the caller claims. The promises are kept in an array variable before Promise.all, and the result is pushed to a typed array. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
function later<R>(text: string): Promise<R> { return Promise.resolve(JSON.parse(text) as R) }
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
const all_of_them: { k: Part }[] = []
async function ask() { const pending = [later<{ k: Part }>('{"k": {"id": 1}}')]; const answer = (await Promise.all(pending))[0]!; all_of_them.push(answer); return all_of_them[0]!.k }
console.log(JSON.stringify(await ask()))
