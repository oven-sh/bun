// An object that has every member of its type and was not made in one piece: its members were added one by one, or a built-in made it.
// It travels as `any` before a typed function first holds it. The type has more than six members, all of them required.
interface Reading { id: number; at: number; low: number; high: number; mean: number; count: number; unit: string; place: { name: string } }
const text = '{"id":1,"at":0.5,"low":1.5,"high":2.5,"mean":3.5,"count":4,"unit":"C","place":{"name":"roof"}}'
let seen: unknown = null
function use(r: Reading) { seen = r; return r.id + r.at + r.low + r.high + r.mean + r.count + r.unit + r.place.name }
const made: Reading = { id: 9, at: 1.5, low: 2.5, high: 3.5, mean: 4.5, count: 5.5, unit: "F", place: { name: "own" } }
const kept: unknown[] = []
const keep = (o: any): any => { kept.push(o); return o }
function row(name: string, f: () => unknown) {
  try { console.log(name + ": " + f()) } catch (e) { console.log(name + ": " + (e instanceof TypeError ? "TypeError" : "other " + e)) }
}
row("made by the program", () => use(made))
row("what does not match is refused", () => { const o: any = {}; const from = JSON.parse(text); for (const k in from) o[k] = from[k]; o.at = "noon"; return use(keep(o)) })
