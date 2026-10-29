// Text evaluated at run time and compiled code take turns on the same objects and prototypes.
function show(f) { try { const v = f(); return typeof v === "function" ? "function" : String(v); } catch (e) { return "threw " + e.constructor.name; } }
class Account { #secret = 1; constructor(n) { this.owner = n; this.balance = 0; this.rate = 1.5; } deposit(n) { this.balance += n; return this; } get double() { return this.balance * 2; } static make(n) { return new Account(n); } peek() { return this.#secret; } }
class Savings extends Account { constructor(n) { super(n); this.locked = false; } deposit(n) { return super.deposit(n * 2); } }
const texts = {
    addField: "o.added = 1; o.added2 = 'x'",
    deleteField: "delete o.balance",
    retype: "o.balance = 'text'; o.rate = {}; o.owner = 5",
    toDouble: "o.balance = 0.5",
    big: "o.balance = 2 ** 40",
    accessor: "Object.defineProperty(o, 'balance', { get() { return 1234 }, set(v) { this.seen = v }, configurable: true })",
    readOnly: "Object.defineProperty(o, 'balance', { value: 3, writable: false })",
    hidden: "Object.defineProperty(o, 'owner', { enumerable: false })",
    protoMethod: "Object.getPrototypeOf(o).deposit = function (n) { this.balance -= n; return this }",
    protoGetter: "Object.defineProperty(Account.prototype, 'double', { get() { return 'replaced' }, configurable: true })",
    protoShadow: "Account.prototype.balance = 'from the prototype'; delete o.balance",
    protoSetter: "Object.defineProperty(Account.prototype, 'fresh', { set(v) { this.caught = v }, configurable: true })",
    swapProto: "Object.setPrototypeOf(o, { deposit() { return 'swapped' }, peek: Account.prototype.peek })",
    nullProto: "Object.setPrototypeOf(o, null)",
    swapParent: "Object.setPrototypeOf(Savings.prototype, { deposit(n) { this.balance = -n; return this } })",
    freeze: "Object.freeze(o)",
    indices: "o[0] = 'zero'; o[5] = 'five'; o[4294967295] = 'big'",
    manyFields: "for (let i = 0; i < 100; i++) o['f' + i] = i; for (let i = 0; i < 100; i += 2) delete o['f' + i]",
    statics: "Account.make = () => 'no account'",
    subclass: "globalThis.Sub = class extends Account { constructor() { super('sub'); this.balance = 'sub' } }; Object.setPrototypeOf(o, Sub.prototype)",
    construct: "globalThis.made = Reflect.construct(Account, ['r'], function () {})",
    constructProxy: "globalThis.made = Reflect.construct(Savings, ['r'], new Proxy(Savings, {}))",
    withStatement: "with (o) { balance = 77; var owner = 'with' }",
};
function use(o) {
    return [show(() => o.owner), show(() => o.balance), show(() => o.rate), show(() => o.locked), show(() => o.deposit(5) === o), show(() => o.balance), show(() => o.double), show(() => o.peek()), show(() => { o.fresh = 4; return o.fresh + "/" + o.caught; }),
        show(() => Object.keys(o).length), show(() => JSON.stringify(o).length), show(() => o.added), show(() => o[0]), show(() => o.seen), show(() => Account.make("z").owner), show(() => o instanceof Account), show(() => { o.balance = 10; o.balance++; return o.balance; })].join("|");
}
const runners = {
    direct: t => eval(t.replaceAll("o.", "shared.").replaceAll("(o", "(shared").replaceAll("o[", "shared[")),
    indirect: t => { globalThis.o = shared; globalThis.Account = Account; globalThis.Savings = Savings; return (0, eval)(t); },
    made: t => new Function("o", "Account", "Savings", t)(shared, Account, Savings),
};
let shared;
const keptProtos = [Account, Savings].map(c => [c, Object.getPrototypeOf(c.prototype), Object.getOwnPropertyDescriptors(c.prototype), Object.getOwnPropertyDescriptors(c)]);
function restore() { for (const [c, parent, members, statics] of keptProtos) { for (const k of Reflect.ownKeys(c.prototype)) if (!(k in members)) delete c.prototype[k]; Object.defineProperties(c.prototype, members); Object.setPrototypeOf(c.prototype, parent); delete statics.prototype; Object.defineProperties(c, statics); } }
const order = process.argv[2] ?? "cold";
for (const [r, run] of Object.entries(runners)) for (const [n, text] of Object.entries(texts)) for (const make of [() => new Account("a"), () => new Savings("s")]) {
    shared = make(); const twin = make();
    const before = order === "warm" ? use(shared) + use(twin) : "";
    const did = show(() => run(text));
    console.log(r, n, shared && shared.constructor && shared.constructor.name, before.length, did, "||", use(shared), "||", use(shared), "||", use(twin), "||", use(make()), "||", show(() => globalThis.made && use(globalThis.made)));
    globalThis.made = undefined;
    restore();
}
