// A generic function returns `JSON.parse(text) as R[]` and none of its parameters mention R, so R is only what the caller claims. A method destructures the first element and stores it in a typed Map. The program must behave as in plain Bun.
type Part = { id?: number; name?: string; more?: unknown }
class Unrelated { k = 1; j = 2; e = 3; ok = 4; value = 5; data = 6; error = 7; held = 8 }
const unrelated = new Unrelated()
if (unrelated.k + unrelated.j + unrelated.e + unrelated.ok + unrelated.value + unrelated.data + unrelated.error + unrelated.held < 0) console.log('never')
const held = new Map<string, { k: Part }>()
function list<R>(text: string): R[] { return JSON.parse(text) as R[] }
class Caller { async ask() { const [answer] = list<{ k: Part }>('[' + '{"k": {"id": 1}}' + ']'); if (!answer) return 'none'; held.set('x', answer); return held.get('x')!.k } }
console.log(JSON.stringify(await new Caller().ask()))
