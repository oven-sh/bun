// Type parameters with constraints, `keyof` and indexed access types: the function body knows only the constraint, and the objects have many types.
interface HasId { id: number }
interface User extends HasId { login: string; admin?: boolean }
type Product = { price: number; id: number; title: string }
class Order implements HasId { id: number; lines: number[] = []; constructor(id: number) { this.id = id } total() { return this.lines.reduce((x, y) => x + y, 0) } }
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function idOf<T extends HasId>(x: T): number { return x.id }
function maxById<T extends HasId>(xs: T[]): T | undefined { let best: T | undefined; for (const x of xs) if (best === undefined || x.id > best.id) best = x; return best }
function renumber<T extends HasId>(x: T, id: number): T { x.id = id; return x }
function get<T, K extends keyof T>(o: T, k: K): T[K] { return o[k] }
function set<T, K extends keyof T>(o: T, k: K, v: T[K]): void { o[k] = v }
function pluck<T, K extends keyof T>(xs: T[], k: K): T[K][] { return xs.map(x => x[k]) }
function pick<T extends object, K extends keyof T>(o: T, ...ks: K[]): Pick<T, K> { const out = {} as Pick<T, K>; for (const k of ks) out[k] = o[k]; return out }
function withDefaults<T extends object>(given: Partial<T>, defaults: T): T { return { ...defaults, ...given } }
function update<T extends HasId>(x: T, patch: Partial<T>): T { return Object.assign(x, patch) }
function clone<T extends object>(o: T): T { return Object.assign(Object.create(Object.getPrototypeOf(o)), o) }
function keysOf<T extends object>(o: T): (keyof T)[] { return Object.keys(o) as (keyof T)[] }
function create<T extends HasId>(make: (id: number) => T, id: number): T { const made = make(id); made.id += 1000; return made }
const user: User = { id: 1, login: "u" }
const admin: User = { admin: true, login: "a", id: 2 }
const product: Product = { price: 9.5, id: 3, title: "p" }
const order = new Order(4)
order.lines.push(1, 2.5)
const bare: HasId = { id: 5 }
const parsed: User = JSON.parse('{"login":"j","id":6}')
console.log(idOf(user), idOf(admin), idOf(product), idOf(order), idOf(bare), idOf(parsed), idOf({ id: -0, more: 1 }))
console.log(maxById([user, admin, parsed])?.login, maxById([product])?.title, maxById<HasId>([order, bare, user])?.id, maxById<User>([]), maxById([order, new Order(0)])?.total())
console.log(renumber(user, 10) === user, user.id, renumber(order, 40).total(), order.id, renumber(parsed, 60).login, show(parsed))

// Keys as constants.
console.log(get(user, "login") + "!", get(user, "id") + 1, get(user, "admin"), get(admin, "admin"), get(product, "price") * 2, get(order, "lines").length, get(order, "total").call(order), get([7, 8], 1), get("str", "length"), get({ "a b": 1 }, "a b"))
set(user, "login", "changed"); set(user, "admin", false); set(product, "price", -0); set(order, "id", 41); set(parsed, "admin", true)
console.log(show(user), Object.is(product.price, -0), order.id, show(parsed))

// Keys as values.
const userKeys: (keyof User)[] = ["admin", "id", "login"]
console.log(userKeys.map(k => String(get(user, k))).join(), userKeys.map(k => String(get(admin, k))).join(), userKeys.map(k => String(get(parsed, k))).join(), userKeys.map(k => k in bare).join())
console.log(keysOf(product).map(k => k + "=" + get(product, k)).join("&"), keysOf(order).join(), keysOf(admin).join())
console.log(pluck([user, admin, parsed], "login").join(), pluck([user, admin, parsed], "admin").map(String).join(), pluck([product], "price").map(p => p + 1).join(), pluck<HasId, "id">([user, product, order, bare], "id").join())
function copyField<T, K extends keyof T>(from: T, to: T, k: K): void { to[k] = from[k] }
for (const k of userKeys) copyField(admin, user, k)
console.log(show(user), show(admin))

// Objects that are created empty and filled by key.
const picked = pick(product, "title", "id")
const pickedUser = pick(admin, "admin")
const pickedOrder = pick(order, "lines", "total", "id")
console.log(show(picked), picked.title.length, picked.id + 1, show(pickedUser), pickedUser.admin, show(pickedOrder), pickedOrder.lines === order.lines, pickedOrder.total.call(order), show(pick(bare)))

console.log(show(withDefaults<User>({ login: "given" }, { id: 0, login: "default", admin: false })), show(withDefaults<Product>({}, product)), show(withDefaults<User>(pick(admin, "admin", "id"), user)))
console.log(show(update(bare, { id: 50 })), bare.id, show(update(user, { admin: undefined, login: "patched" })), "admin" in user, update(order, { lines: [9] }).total(), update(product, {}) === product)
// clone(order): see type-rules/object-create-class-prototype-passes-for-the-class.
console.log(show(clone(admin)), clone(admin) === admin, show(clone(parsed)))
console.log(show(create(id => ({ id, fresh: true }), 1)), create(id => new Order(id), 2).id, create<User>(id => ({ login: "made", id }), 3).login)

// A constraint with an optional field and one with a method.
function tagOf<T extends { tag?: string }>(x: T): string { return x.tag ?? "untagged" }
function run<T extends { run(): number }>(x: T): number { return x.run() + 1 }
class Runner { base = 1; run() { return this.base * 10 } }
console.log(tagOf({}), tagOf({ tag: "t" }), tagOf({ tag: undefined }), tagOf({ tag: "", other: 1 }), run(new Runner()), run({ run: () => 1 }), run({ base: 5, run(this: { base: number }) { return this.base } }))

let total = 0
const everyone: HasId[] = [user, admin, product, order, bare, parsed]
for (let i = 0; i < 5000; i++) { const x = everyone[i % everyone.length]; total += idOf(x) + get(x, "id") + (maxById([x, bare])?.id ?? 0) }
console.log(total)
