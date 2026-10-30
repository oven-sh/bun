// Objects that Object.create makes and a loop fills with accessors, under names that only the run knows. One line a case: the same under any engine.
const lines: string[] = [];
function show(name: string, ...values: unknown[]) {
    lines.push(name + ": " + values.map(value => {
        if (typeof value === "function") return "function " + value.name;
        if (typeof value === "symbol") return value.toString();
        try { return JSON.stringify(value) ?? String(value); } catch (error) { return "unprintable " + (error as Error).name; }
    }).join(" | "));
}
function attempt(run: () => unknown): unknown {
    try { return run(); } catch (error) { return "threw " + (error as Error).name + ": " + (error as Error).message.replace(/ \(evaluating .*$/, ""); }
}
const source: Record<string, string> = { ONE: "1", TWO: "2", THREE: "3", FOUR: "4", FIVE: "5" };
let reads = 0;
function getterFor(key: string): () => unknown { return () => { reads++; return source[key]; }; }

// 1. what Object.create refuses, at a site whose objects get accessors
function make(prototype: any, names: string[]): any {
    const made = Object.create(prototype);
    for (const name of names) Object.defineProperty(made, name, { get: getterFor(name), enumerable: true, configurable: true });
    return made;
}
for (const refused of [undefined, 1, "text", true, Symbol("s"), 10n]) show("refused", attempt(() => make(refused, ["ONE"]).ONE));
const base = { inherited: "from the base", TWO: "hidden by the getter", get viaThis() { return (this as any).ONE + "!"; } };
const names = Object.keys(source);
const under = make(base, names.slice(0, 3)), bare = make(null, names), underFunction = make(function named() {}, ["ONE"]), underProxy = make(new Proxy({ deep: "behind the proxy" }, {}), ["ONE"]);
function readAll(o: any) { return [o.ONE, o.TWO, o.THREE, o.FOUR, o.FIVE, o.inherited, o.viaThis, o.deep, o.name]; }
show("under an object", readAll(under), reads);
show("under null", readAll(bare), reads);
show("under a function", readAll(underFunction));
show("under a proxy", readAll(underProxy));
show("prototypes", Object.getPrototypeOf(under) === base, Object.getPrototypeOf(bare), base.isPrototypeOf(under), under instanceof Object, bare instanceof Object, typeof bare.toString, under.toString === Object.prototype.toString);

// 2. the order of the keys, whichever of them the program names
const mixed = make(base, ["ZULU", "ONE", "not named anywhere else", "TWO", "7", "ALPHA", "3"]);
show("order", Object.keys(mixed), Reflect.ownKeys(mixed), JSON.stringify(mixed), Object.entries(mixed).length);
const inOrder: string[] = []; for (const key in mixed) inOrder.push(key);
show("for in", inOrder);
show("copies", { ...under }, Object.assign({}, bare), Object.getOwnPropertyDescriptor({ ...under }, "ONE"));

// 3. pinned, restored, deleted
function readOne(o: any) { return o.ONE; }
const original = Object.getOwnPropertyDescriptor(under, "ONE")!;
show("as built", readOne(under), original.enumerable, original.configurable, typeof original.get, original.set);
Object.defineProperty(under, "ONE", { value: "pinned", configurable: true, enumerable: true });
show("pinned", readOne(under), readOne(bare), Object.keys(under));
Object.defineProperty(under, "ONE", original);
show("restored", readOne(under), Object.getOwnPropertyDescriptor(under, "ONE")!.get === original.get, Object.keys(under));
delete under.ONE;
show("deleted", readOne(under), "ONE" in under, Object.keys(under), under.viaThis);
(base as any).ONE = "now inherited";
show("inherited in its place", readOne(under), under.viaThis);
Object.defineProperty(under, "ONE", { get: getterFor("FIVE"), enumerable: true, configurable: true });
show("defined again", readOne(under), Object.keys(under));
Object.defineProperty(under, "ONE", { get: (function (this: unknown) { return "bound"; }).bind(null), enumerable: true, configurable: true });
show("a bound getter", readOne(under));
Object.defineProperty(under, "ONE", { get: getterFor("ONE"), enumerable: false, configurable: true });
show("hidden", readOne(under), Object.keys(under));

// 4. stores
show("store", attempt(() => { bare.ONE = "written"; return "stored"; }), bare.ONE, attempt(() => { bare.SIX = "new"; return bare.SIX; }), Object.keys(bare));
const heir = Object.create(bare);
show("store through an heir", attempt(() => { heir.TWO = "x"; return "stored"; }), heir.TWO, Object.keys(heir));

// 5. values beside the accessors
const withWriters = make(null, ["ONE", "TWO"]);
Object.defineProperties(withWriters, { set: { value: (key: string, value: string) => { source[key] = value; } }, unset: { value: (key: string) => { delete source[key]; } } });
withWriters.set("ONE", "changed");
show("writers", withWriters.ONE, Object.keys(withWriters), Object.getOwnPropertyDescriptor(withWriters, "set")!.writable, attempt(() => { withWriters.set = 1; return "stored"; }));
withWriters.unset("ONE"); show("unset", withWriters.ONE); source.ONE = "1";

// 6. integrity
const frozen = Object.freeze(make(base, ["ONE", "TWO"]));
show("frozen", frozen.ONE, Object.isFrozen(frozen), attempt(() => delete frozen.ONE), attempt(() => Object.defineProperty(frozen, "THREE", { get: getterFor("THREE") })), frozen.THREE);
const closed = Object.preventExtensions(make(null, ["ONE"]));
show("not extensible", closed.ONE, attempt(() => Object.defineProperty(closed, "TWO", { get: getterFor("TWO"), enumerable: true, configurable: true })), closed.TWO);

// 7. two loops, two functions, two forms
function other(key: string): () => unknown { return () => key.toLowerCase(); }
function makeTwice(first: string[], second: string[]): any {
    const made = Object.create(null);
    for (const name of first) Object.defineProperty(made, name, { get: getterFor(name), enumerable: true, configurable: true });
    for (const name of second) Object.defineProperty(made, name, { get: other(name), enumerable: true, configurable: true });
    return made;
}
const twice = makeTwice(["ONE", "TWO"], ["TWO", "THREE"]);
show("two functions", twice.ONE, twice.TWO, twice.THREE, Object.keys(twice));
function makeForms(shown: string[], hiddenNames: string[]): any {
    const made = Object.create(null);
    for (const name of shown) Object.defineProperty(made, name, { get: getterFor(name), enumerable: true, configurable: true });
    for (const name of hiddenNames) Object.defineProperty(made, name, { get: getterFor(name) });
    return made;
}
const forms = makeForms(["ONE"], ["TWO"]);
show("two forms", forms.ONE, forms.TWO, Object.keys(forms), attempt(() => delete forms.TWO), delete forms.ONE);

// 8. accessors and values under the same unknown names
function makeEither(entries: [string, boolean][]): any {
    const made = Object.create(base);
    for (const [name, isValue] of entries) {
        if (isValue) made[name] = "value of " + name;
        else Object.defineProperty(made, name, { get: getterFor(name), enumerable: true, configurable: true });
    }
    return made;
}
const either = makeEither([["ONE", false], ["TWO", true], ["THREE", false]]);
show("either", either.ONE, either.TWO, either.THREE, Object.keys(either));

// 9. other ways to the same built-in, and its second argument
const create = Object.create;
function byAlias(): any { const made = create(base); Object.defineProperty(made, "ONE", { get: getterFor("ONE"), enumerable: true, configurable: true }); return made; }
function inTailPosition(prototype: object | null) { return Object.create(prototype); }
show("alias", byAlias().ONE, byAlias().inherited, (Object.create as any).call(null, base).inherited, Reflect.apply(Object.create, undefined, [base]).inherited, inTailPosition(base).inherited, attempt(() => inTailPosition(5 as never)));
show("with a map", Object.create(base, { own: { get: getterFor("TWO"), enumerable: true } }).own, attempt(() => Object.create(base, null as never)), Object.keys(Object.create(null, { a: { value: 1, enumerable: true } })), Object.keys(Object.create(base, undefined as never)));

// 10. a prototype made by Object.create that holds accessors
function Parent(this: any) { this.own = "own"; }
Parent.prototype.greet = function () { return "parent"; };
function Child(this: any) { Parent.call(this); }
Child.prototype = Object.create(Parent.prototype);
Object.defineProperty(Child.prototype, "described", { get() { return this.own + " " + this.greet(); }, enumerable: false, configurable: true });
Child.prototype.constructor = Child;
const child = new (Child as any)();
show("as a prototype", child.described, child instanceof (Parent as any), Object.keys(child), Object.keys(Child.prototype));

// 11. many, with collections
let total = 0;
for (let i = 0; i < 5000; i++) { const made = make(i & 1 ? base : null, names); total += Number(made.ONE) + Number(made.FIVE); if (i % 1000 === 0) Bun.gc(true); }
show("many", total);

// 12. symbols and a key that is computed to a name the program reads
const mark = Symbol("mark");
function makeWithKeys(keys: (string | symbol)[]): any {
    const made = Object.create(null);
    for (const key of keys) Object.defineProperty(made, key, { get: () => String(key).length, enumerable: true, configurable: true });
    return made;
}
const keyed = makeWithKeys([mark, "O" + "NE", "length"]);
show("keys", keyed[mark], keyed.ONE, keyed.length, Reflect.ownKeys(keyed));

console.log(lines.join("\n"));
