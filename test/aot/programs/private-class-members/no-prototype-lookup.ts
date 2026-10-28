// Private names are looked up on the object itself, never on its prototype chain.
// COUNTER: UseAsPrototype >= 1
// COUNTER: PrototypeChange >= 1
function said(f: () => unknown): string { try { return String(f()) } catch (e) { return "threw " + (e as Error).name } }
function show(...parts: unknown[]): void { console.log(parts.join(" | ")) }

class Identity { constructor(o: any) { return o } }
class Vault {
  open: number = 1
  #key: number = 5
  #turn(): number { return this.#key + 1 }
  get #state(): string { return "locked" }
  static #master: number = 9
  static #reset(): string { return "reset" }
  static has(o: object): string { return [#key in o, #turn in o, #state in o].join() }
  static read(o: any): string { return said(() => o.#key) + " " + said(() => o.#turn()) + " " + said(() => o.#state) }
  static write(o: any): string { return said(() => (o.#key = 1)) }
  static hasStatic(o: object): string { return [#master in o, #reset in o].join() }
  static readStatic(o: any): string { return said(() => o.#master) + " " + said(() => o.#reset()) }
}
function makeVault() {
  return class {
    open: number = 1
    #key: number = 6
    #turn(): number { return 60 }
    static has(o: object): string { return [#key in o, #turn in o].join() }
    static read(o: any): string { return said(() => o.#key) + " " + said(() => o.#turn()) }
  }
}
class Stamp extends Identity {
  #mark: number = 1
  static has(o: object): boolean { return #mark in o }
}

const LocalVault = makeVault(), SecondVault = makeVault()
const makeRecord = () => ({ open: 1 } as { open: number })
const stamped = {}
new Stamp(stamped)
let trapped = 0
const subjects: [string, any][] = [
  ["an instance", new Vault()],
  ["an instance of LocalVault", new LocalVault()],
  ["an instance of the second evaluation", new SecondVault()],
  ["an object below an instance", Object.create(new Vault())],
  ["two below", Object.create(Object.create(new Vault()))],
  ["a record under Vault.prototype", Object.setPrototypeOf(makeRecord(), Vault.prototype)],
  ["a record under LocalVault.prototype", Object.setPrototypeOf(makeRecord(), LocalVault.prototype)],
  ["a record under an instance", Object.setPrototypeOf(makeRecord(), new Vault())],
  ["an instance without a prototype", Object.setPrototypeOf(new Vault(), null)],
  ["a Vault under LocalVault.prototype", Object.setPrototypeOf(new Vault(), LocalVault.prototype)],
  ["a LocalVault under Vault.prototype", Object.setPrototypeOf(new LocalVault(), Vault.prototype)],
  ["Vault.prototype", Vault.prototype],
  ["LocalVault.prototype", LocalVault.prototype],
  ["a proxy of an instance", new Proxy(new Vault(), { has() { trapped++; return true }, get() { trapped++; return 1 } })],
  ["the stamped object", stamped],
  ["an object below it", Object.create(stamped)],
  ["a Vault under it", Object.setPrototypeOf(new Vault(), stamped)],
  ["a record under it", Object.setPrototypeOf(makeRecord(), stamped)],
]
for (const [title, o] of subjects) show(title, Vault.has(o), Vault.read(o), LocalVault.has(o), LocalVault.read(o), Stamp.has(o))
show("proxy traps called", trapped)

const owner = new Vault(), below = Object.create(owner)
show("a store below the owner", Vault.write(below), Vault.has(below), Vault.read(owner))
show("a store on the owner", Vault.write(owner), Vault.has(below), Vault.read(owner))

class Sub extends Vault {}
const holders: [string, any][] = [["Vault", Vault], ["Sub", Sub], ["an object below Vault", Object.create(Vault)], ["an instance", new Vault()]]
for (const [title, o] of holders) show("static elements", title, Vault.hasStatic(o), Vault.readStatic(o))
export {}
