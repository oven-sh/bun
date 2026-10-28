// Private methods, accessors and fields still work after an instance loses its layout and becomes an ordinary object.
// COUNTER: DeleteOfRequiredField >= 1
// COUNTER: RedefinedProperty >= 1
// COUNTER: PrototypeChange >= 1
// COUNTER: UseAsPrototype >= 1
// COUNTER: StoreOfOtherType >= 1
// COUNTER: IndexedAccessor >= 1
// COUNTER: ShadowedMethod >= 1
// COUNTER: NoExtraPropertiesWord = 0
type Change = (o: any) => void
function said(f: () => unknown): string { try { return String(f()) } catch (e) { return "threw " + (e as Error).name } }
function show(...parts: unknown[]): void { console.log(parts.join(" | ")) }

class Account {
  balance: number = 1
  note?: string = "n"
  #secret: number = 7
  #double(): number { return this.#secret * 2 }
  get #view(): string { return "v" + this.#secret }
  set #view(text: string) { this.#secret = text.length }
  get #only(): number { return this.balance }
  describe(): string { return "account" }
  method(): unknown { return this.#double }
  use(): string { this.#view = this.#view + "!"; return [this.#double(), this.#view, this.#only, this.#secret, #double in this, #view in this, #secret in this].join() }
  midway(change: Change): string { const before = this.#double(); change(this); return before + " then " + this.#double() + " " + this.#view + " " + (#double in this) }
  static has(o: object): string { return [#secret in o, #double in o, #view in o, #only in o].join() }
  static useOn(o: Account): string { return o.#double() + " " + o.#view + " " + o.#secret }
}
class Savings extends Account {
  rate: number = 2
  #grow(): number { return this.rate * 3 }
  get #tag(): string { return "s" + this.rate }
  grow(): string { return this.#grow() + this.#tag + (#grow in this) }
  static owns(o: object): boolean { return #grow in o && #tag in o }
}

const children: object[] = []
const changes: [string, Change][] = [
  ["nothing", () => {}],
  ["add a name", o => { o.extra = 1 }],
  ["freeze", o => { Object.freeze(o) }],
  ["shadow a method", o => { o.describe = () => "own" }],
  ["delete required", o => { delete o.balance }],
  ["accessor", o => { Object.defineProperty(o, "balance", { get: () => 5, enumerable: true, configurable: true }) }],
  ["read-only", o => { Object.defineProperty(o, "balance", { writable: false }) }],
  ["other prototype", o => { Object.setPrototypeOf(o, Object.create(Object.getPrototypeOf(o))) }],
  ["null prototype", o => { Object.setPrototypeOf(o, null) }],
  ["use as prototype", o => { children.push(Object.create(o)) }],
  ["other type and back", o => { o.balance = "text"; o.balance = 4 }],
  ["index accessor", o => { Object.defineProperty(o, 0, { get: () => 0, configurable: true }) }],
]
const makers: [string, () => Account][] = [["Account", () => new Account()], ["Savings", () => new Savings()]]

for (const [title, change] of changes) {
  for (const [className, make] of makers) {
    const o = make()
    change(o)
    show(
      title,
      className,
      said(() => Account.prototype.use.call(o)),
      Account.has(o),
      said(() => Account.useOn(o)),
      Account.prototype.method.call(o) === Account.prototype.method.call(new Account()),
      said(() => Account.prototype.midway.call(make(), change)),
      Savings.owns(o),
      said(() => Savings.prototype.grow.call(o)),
    )
  }
}
for (const child of children) show("below an instance", Account.has(child))

let complete = 0, total = 0
for (let i = 0; i < 200; i++) {
  const o = i % 2 === 0 ? new Account() : new Savings()
  if (i % 3 === 0) changes[(i / 3) % changes.length][1](o)
  if (Account.has(o) === "true,true,true,true") complete++
  total += Account.useOn(o).length
}
show("one site, many states", complete, total)
export {}
