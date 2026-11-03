// Own accessors, read in every way and changed in every way. Prints one line a case: the same under any engine.
const lines: string[] = [];
function show(name: string, ...values: unknown[]) {
    lines.push(name + ": " + values.map(value => {
        if (typeof value === "function") return "function " + value.name;
        if (typeof value === "symbol") return value.toString();
        try { return JSON.stringify(value) ?? String(value); } catch (error) { return "unprintable " + (error as Error).name; }
    }).join(" | "));
}
function attempt(run: () => unknown): unknown {
    try { return run(); } catch (error) { return "threw " + (error as Error).name + ": " + (error as Error).message.slice(0, 60); }
}
let calls = 0;

// 1. plain getters of a literal, read by name, in a loop
const plain = { get first() { calls++; return 1; }, get second() { calls++; return "two"; }, third: 3 };
function readPlain() { return plain.first + plain.second + plain.third; }
for (let i = 0; i < 3; i++) show("plain", readPlain(), calls);

// 2. this
const usesThis = { base: 10, get twice() { return this.base * 2; } };
show("this", usesThis.twice, (usesThis.base = 21, usesThis.twice));
const heir = Object.create(usesThis); heir.base = 4;
show("this through a prototype", heir.twice, Reflect.get(usesThis, "twice", { base: 100 }));
show("this through a proxy", new Proxy(usesThis, {}).twice, new Proxy(usesThis, { get: (target, key, receiver) => key === "base" ? 7 : Reflect.get(target, key, receiver) }).twice);

// 3. a pair
const pair = { held: 0, get value() { return this.held + 1; }, set value(next: number) { this.held = next * 10; } };
pair.value = 5;
show("pair", pair.value, pair.held, Object.keys(pair), typeof Object.getOwnPropertyDescriptor(pair, "value")!.set);
const setterFirst = { held: 0, set value(next: number) { this.held = next; }, get value() { return this.held - 1; } };
setterFirst.value = 9;
show("pair, setter first", setterFirst.value);
const setterAlone: any = { held: 1, set only(next: number) { this.held = next; } };
show("setter alone", setterAlone.only, (setterAlone.only = 3, setterAlone.held));

// 4. a store to a getter without a setter throws in strict code
const readOnly: any = { get fixed() { return 1; } };
show("store without a setter", attempt(() => { readOnly.fixed = 2; return "stored"; }), readOnly.fixed);

// 5. a getter that throws
const thrower = { get bad(): number { throw new RangeError("from the getter"); }, good: 1 };
function readBad() { return thrower.bad; }
for (let i = 0; i < 2; i++) show("throws", attempt(readBad), thrower.good);

// 6. a getter that makes a value of itself
const lazy: any = { get once() { calls++; Object.defineProperty(this, "once", { value: "made", writable: true, enumerable: true, configurable: true }); return "making"; } };
function readOnce() { return lazy.once; }
show("redefines itself", readOnce(), readOnce(), readOnce(), Object.getOwnPropertyDescriptor(lazy, "once"));
const lazyByDelete: any = { get once() { delete this.once; this.once = "stored"; return "storing"; } };
function readOnceMore() { return lazyByDelete.once; }
show("deletes itself", readOnceMore(), readOnceMore(), Object.keys(lazyByDelete));

// 7. deleted, and back in other forms
const deleted: any = { a: 1, get gone() { return "there"; }, z: 2 };
function readGone() { return deleted.gone; }
show("before the deletion", readGone(), "gone" in deleted, Object.keys(deleted));
delete deleted.gone;
show("deleted", readGone(), "gone" in deleted, Object.hasOwn(deleted, "gone"), Object.keys(deleted));
Object.defineProperty(deleted, "gone", { get: () => "another getter", enumerable: true, configurable: true });
show("back as another getter", readGone(), Object.keys(deleted));
delete deleted.gone; deleted.gone = "a value";
show("back as a value", readGone(), Object.keys(deleted));
delete deleted.gone; Object.setPrototypeOf(deleted, { get gone() { return "inherited"; } });
show("inherited behind the deletion", readGone());

// 8. replaced in place, the same attributes
const replaced: any = { get now() { return "first"; } };
function readNow() { return replaced.now; }
show("as defined", readNow());
Object.defineProperty(replaced, "now", { get() { return "second"; } });
show("another function", readNow(), Object.getOwnPropertyDescriptor(replaced, "now")!.enumerable);
Object.defineProperty(replaced, "now", { get: Math.random.bind(null).constructor === Function ? (function (this: unknown) { return "bound " + this; }).bind("receiver") : undefined });
show("a bound function", readNow());
Object.defineProperty(replaced, "now", { get: new Proxy(function () { return "behind a proxy"; }, {}) });
show("a proxy of a function", readNow());
Object.defineProperty(replaced, "now", { get: Date.now });
show("a native function", typeof readNow());
Object.defineProperty(replaced, "now", { get: undefined });
show("no getter", readNow(), Object.getOwnPropertyDescriptor(replaced, "now"));
Object.defineProperty(replaced, "now", { value: 5 });
show("a value", readNow(), Object.getOwnPropertyDescriptor(replaced, "now"));

// 9. only an attribute changes
const hidden: any = { get seen() { return "still"; }, other: 1 };
Object.defineProperty(hidden, "seen", { enumerable: false });
show("no longer enumerable", hidden.seen, Object.keys(hidden), JSON.stringify(hidden), Object.getOwnPropertyDescriptor(hidden, "seen")!.configurable);

// 10. frozen, sealed
const frozen: any = Object.freeze({ get cold() { return "cold"; }, value: 1 });
function readCold() { return frozen.cold; }
show("frozen", readCold(), Object.isFrozen(frozen), Object.getOwnPropertyDescriptor(frozen, "cold")!.configurable, attempt(() => delete frozen.cold), attempt(() => Object.defineProperty(frozen, "cold", { get: () => 1 })), readCold());
const sealed: any = Object.seal({ get shut() { return "shut"; } });
show("sealed", sealed.shut, Object.isSealed(sealed), Object.isFrozen(sealed), attempt(() => delete sealed.shut));
const closed: any = Object.preventExtensions({ get kept() { return "kept"; } });
delete closed.kept;
show("not extensible, deleted", closed.kept, attempt(() => Object.defineProperty(closed, "kept", { get: () => 1, configurable: true, enumerable: true })));

// 11. whoever walks the properties
let walked = 0;
const walkedObject = { a: 1, get b() { walked++; return 2; }, c: 3, get d() { walked++; return { deep: true }; } };
show("keys", Object.keys(walkedObject), Object.getOwnPropertyNames(walkedObject), Reflect.ownKeys(walkedObject), walked);
show("values", Object.values(walkedObject), Object.entries(walkedObject), walked);
show("JSON", JSON.stringify(walkedObject), walked);
show("spread", { ...walkedObject }, Object.getOwnPropertyDescriptor({ ...walkedObject }, "b"), walked);
show("assign", Object.assign({}, walkedObject), Object.assign({ b: 0 }, walkedObject).b, walked);
const { b: taken, ...rest } = walkedObject;
show("rest", taken, rest, walked);
const names: string[] = []; for (const name in walkedObject) names.push(name);
show("for in", names, walked);
show("structuredClone", structuredClone(walkedObject), walked);
show("descriptors", Object.keys(Object.getOwnPropertyDescriptors(walkedObject)), typeof Object.getOwnPropertyDescriptors(walkedObject).b.get, Object.getOwnPropertyDescriptors(walkedObject).b.set);
show("the same function", Object.getOwnPropertyDescriptor(walkedObject, "b")!.get === Object.getOwnPropertyDescriptor(walkedObject, "b")!.get, Object.getOwnPropertyDescriptor(walkedObject, "b")!.get!.name);
show("lookupGetter", (walkedObject as any).__lookupGetter__("b") === Object.getOwnPropertyDescriptor(walkedObject, "b")!.get, (walkedObject as any).__lookupGetter__("a"));
show("propertyIsEnumerable", Object.prototype.propertyIsEnumerable.call(walkedObject, "b"), Object.hasOwn(walkedObject, "d"), "d" in walkedObject);

// 12. closures: one function, many objects
function counter(start: number, step: number) {
    let current = start;
    return { get next() { current += step; return current; }, get start() { return start; } };
}
const byOne = counter(0, 1), byTen = counter(100, 10);
function drain(source: { readonly next: number; readonly start: number }) { return source.next + source.next + source.start; }
show("closures", drain(byOne), drain(byTen), drain(byOne), drain(byTen));

// 13. one shape, other functions
function shapeA() { return { get kind() { return "A"; }, size: 1 }; }
function shapeB() { return { get kind() { return "B"; }, size: 2 }; }
function shapeC() { return { kind: "C", size: 3 }; }
function kindOf(thing: { readonly kind: string; size: number }) { return thing.kind + thing.size; }
show("three makers", [shapeA(), shapeB(), shapeC(), shapeA(), shapeC(), shapeB()].map(kindOf));

// 14. defineProperty under constant names, every form
const defined: any = {};
Object.defineProperty(defined, "plain", { get: () => "plain" });
Object.defineProperty(defined, "listed", { get: () => "listed", enumerable: true });
Object.defineProperty(defined, "loose", { get: () => "loose", configurable: true });
Object.defineProperty(defined, "both", { get: () => "both", enumerable: true, configurable: true });
function readDefined() { return [defined.plain, defined.listed, defined.loose, defined.both]; }
show("defined", readDefined(), Object.keys(defined), attempt(() => delete defined.plain), delete defined.loose, readDefined());
show("defined twice", attempt(() => Object.defineProperty(defined, "plain", { get: () => "again" })), attempt(() => Object.defineProperty(defined, "both", { get: () => "again" })), readDefined());

// 15. built by a loop
const table = { ALPHA: (text: string) => text + "!", BETA: (text: string) => text + "?", GAMMA: (text: string) => text.toUpperCase() };
function build(shape: Record<string, (text: string) => string>): any {
    const accessor = {};
    for (const key of Object.keys(shape)) {
        const parse = shape[key]!;
        Object.defineProperty(accessor, key, { enumerable: true, configurable: true, get: () => parse(key.toLowerCase()) });
    }
    return accessor;
}
const built = build(table) as { ALPHA: string; BETA: string; GAMMA: string };
function readBuilt() { return built.ALPHA + built.BETA + built.GAMMA; }
show("built by a loop", readBuilt(), Object.keys(built), (built as any).DELTA);
Object.defineProperty(built, "BETA", { value: "pinned", configurable: true });
show("one of them pinned", readBuilt());
delete (built as any).ALPHA;
show("one of them deleted", readBuilt(), Object.keys(built));

// 16. other keys
const mark = Symbol("mark");
const otherKeys: any = { get [mark]() { return "symbol"; }, get 0() { return "index"; }, get ["comp" + "uted"]() { return "computed"; }, get "with space"() { return "quoted"; } };
show("other keys", otherKeys[mark], otherKeys[0], otherKeys.computed, otherKeys["with space"], Reflect.ownKeys(otherKeys));

// 17. super in a getter
const below = { __proto__: { get word() { return "above"; } }, get word(): string { return "below " + super.word; } };
show("super", below.word);

// 18. an object with getters as a prototype
class OnTop { declare inherited: string; own = "own"; }
Object.setPrototypeOf(OnTop.prototype, { get inherited() { return "from " + (this as any).own; } });
function readInherited(top: OnTop) { return top.inherited; }
show("under a class", readInherited(new OnTop()), readInherited(new OnTop()));

// 19. by key
const byKey: any = { get one() { return 1; }, get two() { return 2; }, three: 3 };
let sum = 0; for (const key of ["one", "two", "three", "four", "one"]) sum += byKey[key] ?? 100;
show("by key", sum);

// 20. defineGetter
const old: any = { kept: 1 };
old.__defineGetter__("late", function (this: any) { return this.kept + 1; });
show("defineGetter", old.late, Object.getOwnPropertyDescriptor(old, "late")!.enumerable, Object.keys(old));

// 21. a getter that changes its neighbours
const shifty: any = { get a() { delete this.b; return "a"; }, get b() { return "b"; }, get c() { Object.defineProperty(this, "a", { get: () => "new a", configurable: true, enumerable: true }); return "c"; } };
function readShifty() { return [shifty.a, shifty.b, shifty.c, shifty.a]; }
show("neighbours", readShifty(), readShifty(), Object.keys(shifty));

// 22. many objects, and collections in between
let total = 0;
for (let i = 0; i < 20000; i++) { const made = counter(i, 2); total += made.next + made.start; if (i % 5000 === 0) Bun.gc(true); }
show("many", total);

// 23. what a getter returns
const mixed = { turn: 0, get any(): unknown { this.turn++; return [1, "s", null, undefined, { o: 1 }, 1.5, true][this.turn % 7]; } };
const seen: unknown[] = []; for (let i = 0; i < 8; i++) seen.push(mixed.any);
show("mixed results", seen);

// 24. typeof, optional chains, calls of what a getter returns
const callable = { get run() { return function (this: unknown) { return this === callable; }; }, get nothing() { return undefined; } };
show("called", callable.run(), typeof callable.run, (callable as any).nothing?.deep, String(attempt(() => (callable as any).nothing())).slice(0, 15));

// 25. compound stores
const compound = { held: 1, get n() { return this.held; }, set n(value: number) { this.held = value; } };
compound.n += 4; compound.n++; compound.n *= 2;
show("compound", compound.n, compound.held);

// 26. class instances that get an own accessor
class Plain { x = 1; }
const decorated: any = new Plain();
Object.defineProperty(decorated, "x", { get: () => "over the field", configurable: true });
Object.defineProperty(decorated, "y", { get: () => "new name", configurable: true });
show("over a field of a class", decorated.x, decorated.y, new Plain().x);

console.log(lines.join("\n"));
