// The key order when fields are added late, deleted and added again.
interface O { a: number; b?: number; c?: string; d?: boolean }
function show(o: object) { return Object.keys(o).join() + " " + JSON.stringify(o) }
function build(x: boolean, y: boolean): O { const o: O = { a: 1 }; if (x) o.c = "c"; if (y) o.b = 2; return o }
console.log(show(build(true, true)), show(build(false, true)), show(build(true, false)), show(build(false, false)))
const mixed: O = { a: 1, d: true }
const open: any = mixed
mixed.c = "late"; mixed.b = 5
console.log(show(mixed))
delete open.c; mixed.c = "again"; open.a = 9
console.log(show(mixed), mixed.a + 1, mixed.c, "c" in mixed)
for (const k in mixed) console.log(k, (mixed as any)[k])
const again: O = { d: false, a: 2 }
delete (again as any).d
again.d = true; again.b = 1; delete again.b; again.c = "x"; again.b = 3
console.log(show(again), Object.entries(again).map(e => e.join("=")).join("&"), show({ ...again }), show(Object.assign({}, again)))
const sealed: O = Object.seal({ a: 1 } as O)
try { sealed.b = 2 } catch (e) { console.log((e as Error).constructor.name) }
console.log(show(sealed), Reflect.ownKeys(again).join())
function many(n: number) { const list: O[] = []; for (let i = 0; i < n; i++) { const o: O = i & 1 ? { a: i, b: i } : { b: i, a: i }; if (i % 3 === 0) o.d = true; list.push(o) } return list.map(o => Object.keys(o).join("")).join() }
console.log(many(7))
