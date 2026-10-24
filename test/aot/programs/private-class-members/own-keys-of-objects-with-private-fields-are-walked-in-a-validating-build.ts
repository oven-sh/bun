// The own keys of an instance with private fields, a private method or both are walked by a rest pattern, a spread, Object.keys | values | entries | assign, for-in and JSON.stringify: on the object where it is made, on one that a variable of the module holds, and on one out of a list. A private name is no key: as in plain Bun, and a validating build has nothing to find.
class Field { #hidden = 1; shown = 2; other = 3; read() { return this.#hidden } }
class Method { #method() { return 1 } shown = 2; other = 3; read() { return this.#method() } }
class Between { shown = 2; #hidden = 1; other = 3; read() { return this.#hidden } }
class Last { shown = 2; other = 3; #hidden = 1; read() { return this.#hidden } }
class Only { #hidden = 1; shown = 2; read() { return this.#hidden } }
class Late { #hidden = 1; shown = 2; late?: string; read() { return this.#hidden } }
class TwoOrders { #hidden = 1; shown = 0; other = 0; a?: number; b?: number; constructor(first: boolean) { if (first) { this.a = 1; this.b = 2 } else { this.b = 2; this.a = 1 } } read() { return this.#hidden } }
class Below extends Field { #more = 4; added = 5; readMore() { return this.#more } }
type Shown = { shown: number; read(): number }
function walks(o: Shown): string {
  const { shown, ...rest } = o
  const seen: string[] = []
  for (const key in o) seen.push(key)
  return [JSON.stringify(rest), JSON.stringify({ ...o }), Object.keys(o).join(), Object.values(o).join(), JSON.stringify(Object.entries(o)), JSON.stringify(Object.assign({}, o)), seen.join(), JSON.stringify(o), Reflect.ownKeys(o).length, shown, o.read()].join(" ")
}
function repeat(label: string, make: (round: number) => Shown): void {
  let last = ""
  for (let round = 0; round < 300; round++) last = walks(make(round))
  console.log(label, last)
}
const held = { field: new Field(), method: new Method(), between: new Between(), last: new Last(), only: new Only(), late: new Late(), below: new Below() }
const list: Shown[] = [new Field(), new Method(), new Between(), new Last(), new Only(), new Late(), new TwoOrders(true), new TwoOrders(false), new Below()]
repeat("made here: field", () => new Field())
repeat("made here: method", () => new Method())
repeat("made here: between", () => new Between())
repeat("made here: last", () => new Last())
repeat("made here: only", () => new Only())
repeat("made here: late", () => new Late())
repeat("made here: two orders, the first", () => new TwoOrders(true))
repeat("made here: two orders, the second", () => new TwoOrders(false))
repeat("made here: two orders, in turn", round => new TwoOrders(round % 2 === 0))
repeat("made here: below", () => new Below())
repeat("held: field", () => held.field)
repeat("held: method", () => held.method)
repeat("held: between", () => held.between)
repeat("held: last", () => held.last)
repeat("held: only", () => held.only)
repeat("held: late", () => held.late)
repeat("held: below", () => held.below)
for (let which = 0; which < list.length; which++) repeat("out of a list: " + which, () => list[which])
const secret = new Only()
function restOfSecret() { const { shown, ...rest } = secret; return rest }
let last: object = {}
for (let i = 0; i < 2000; i++) last = restOfSecret()
console.log("a variable of the module", JSON.stringify(last), Object.keys(last).join())
