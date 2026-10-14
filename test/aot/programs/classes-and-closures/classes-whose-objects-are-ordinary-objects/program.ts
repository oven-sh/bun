class AppError extends Error {
  code: number
  constructor(message: string, code = 1) { super(message); this.name = "AppError"; this.code = code }
  describe(): string { return this.name + "(" + this.code + "): " + this.message }
  get isFatal(): boolean { return this.code > 9 }
}
class NotFound extends AppError {
  constructor(public what: string) { super(what + " not found", 44) ; this.name = "NotFound" }
  describe(): string { return "[" + super.describe() + "]" }
}
const e1 = new AppError("boom")
const e2 = new NotFound("file")
console.log(e1.describe(), e2.describe(), e1 instanceof Error, e2 instanceof AppError, e1 instanceof NotFound, e2.isFatal, e2.what, String(e2), Object.keys(e2).join())
try { throw new NotFound("key") } catch (e) { console.log(e instanceof NotFound && e.what, typeof (e as Error).stack) }

function make(tag: string) { return class { tag = tag; static made = tag + "!"; who(): string { return this.tag } } }
const A = make("a"), B = make("b")
console.log(new A().who(), new B().who(), A.made, B.made, new A() instanceof A, new A() instanceof B, A === B, typeof A, A.name)

const key = "dynamic", staticKey = key + "Static", fieldKey = "field" + 1
class Computed { [key]() { return 1 } static [staticKey] = 2; [fieldKey] = 3; get [key + "Get"]() { return 4 } }
const c: any = new Computed()
console.log(c.dynamic(), (Computed as any).dynamicStatic, c.field1, c.dynamicGet, Object.getOwnPropertyNames(Computed.prototype).join())

class Counter { static n = 0; static start = Counter.n + 100; static next() { return ++this.n } static create() { return new this() } id = Counter.next() }
console.log(Counter.create().id, Counter.create().id, Counter.n, Counter.start)
const classes: Ctor[] = [Counter, AppError]
console.log(classes.map(k => k.name).join(), new classes[0]!().constructor === Counter, Object.getPrototypeOf(NotFound) === AppError)

class Vault { #secret = 7; #twice() { return this.#secret * 2 } static has(o: object) { return #secret in o } open() { return this.#twice() + this.#secret++ } }
const vault: any = new Vault()
console.log(vault.open(), vault.open(), Vault.has(vault), Vault.has({}), Object.keys(vault).length, JSON.stringify(vault))

function Old(this: any, v: number) { this.v = v }
Old.prototype.get = function () { return this.v }
const old = new (Old as any)(5)
console.log(old.get(), old instanceof (Old as any), old.constructor === Old)
class Target { kind: string; constructor() { this.kind = new.target.name } }
class SubTarget extends Target {}
console.log(new Target().kind, new SubTarget().kind)
type Ctor<T = {}> = new (...args: any[]) => T
function Tagged<T extends Ctor>(Base: T) { return class extends Base { tagged = true } }
class Plain { plain = 1 }
const Mixed = Tagged(Plain)
const mixed = new Mixed()
console.log(mixed.tagged, mixed.plain, mixed instanceof Plain)
try { (AppError as any)("x") } catch (e) { console.log((e as Error).constructor.name) }
