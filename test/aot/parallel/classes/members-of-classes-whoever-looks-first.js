// Who looks at a class first, and how: each class below is touched first in another way.
const out = [];
const say = (...words) => out.push(words.join(" "));
class ByKeys { a() { } b() { } static s() { } }
say(Object.getOwnPropertyNames(ByKeys.prototype).join(), Object.getOwnPropertyNames(ByKeys).join());
class ByIn { a() { } }
say("a" in ByIn.prototype, "b" in ByIn.prototype, "a" in new ByIn(), Object.hasOwn(ByIn.prototype, "a"), ByIn.prototype.hasOwnProperty("constructor"));
class ByStore { a() { return 1; } b() { return 2; } }
ByStore.prototype.z = 26;
say(Reflect.ownKeys(ByStore.prototype).join(), new ByStore().a(), new ByStore().z);
class ByStaticStore { static a() { return 1; } b() { return 2; } }
ByStaticStore.z = 26;
say(Reflect.ownKeys(ByStaticStore).join(), ByStaticStore.a(), ByStaticStore.z);
class ByDelete { a() { return 1; } b() { return 2; } }
say(delete ByDelete.prototype.a, Reflect.ownKeys(ByDelete.prototype).join(), typeof new ByDelete().a);
class ByAssign { a() { return 1; } }
say(Object.keys(Object.assign({}, ByAssign.prototype)).length, JSON.stringify(ByAssign.prototype), Object.entries(ByAssign.prototype).length);
class BySpread { a() { return 1; } get g() { return 2; } }
say(Object.keys({ ...BySpread.prototype }).length, Object.keys(Object.getOwnPropertyDescriptors(BySpread.prototype)).join());
class ByCreate { a() { return "made below"; } }
say(Object.create(ByCreate.prototype).a(), Object.create(ByCreate.prototype) instanceof ByCreate);
class ByExtendsLate { a() { return "above"; } }
const Below = class extends ByExtendsLate { b() { return this.a() + " and below"; } };
say(new Below().b());
class ByReflect { a(x) { return x; } }
say(Reflect.get(ByReflect.prototype, "a")(5), Reflect.has(ByReflect.prototype, "a"), Reflect.getOwnPropertyDescriptor(ByReflect.prototype, "a").enumerable);
class ByProxy { a() { return "through"; } }
say(new Proxy(ByProxy.prototype, {}).a(), new Proxy(new ByProxy(), {}).a());
class ByToString { toString() { return "as text"; } valueOf() { return 42; } }
say(`${new ByToString()}`, new ByToString() + 1, String(new ByToString()));
class ByJSON { constructor() { this.v = 1; } toJSON() { return { w: this.v }; } }
say(JSON.stringify(new ByJSON()), JSON.stringify([new ByJSON()]));
class ByThen { then(resolve) { resolve("thenable"); } }
class ByIterator { [Symbol.iterator]() { let i = 0; return { next: () => ({ done: i > 1, value: i++ }) }; } }
say([...new ByIterator()].join(), Array.from(new ByIterator()).join());
class ByDefine { a() { return 1; } }
Object.defineProperty(ByDefine.prototype, "a", { get() { return () => "redefined"; }, configurable: true });
say(new ByDefine().a(), Reflect.ownKeys(ByDefine.prototype).join());
class ByPrototypeOf { a() { return 1; } }
say(Object.getPrototypeOf(new ByPrototypeOf()) === ByPrototypeOf.prototype, ByPrototypeOf.prototype.isPrototypeOf(new ByPrototypeOf()));
class BySetPrototype { a() { return "first"; } }
const moved = new BySetPrototype();
Object.setPrototypeOf(moved, { a() { return "moved"; } });
say(moved.a(), new BySetPrototype().a());
class ByCall { a() { return this.k; } }
say(ByCall.prototype.a.call({ k: "called" }), ByCall.prototype.a.apply({ k: "applied" }), ByCall.prototype.a.bind({ k: "bound" })());
class ByTypeof { a() { } static b() { } }
say(typeof ByTypeof, typeof ByTypeof.prototype, typeof ByTypeof.prototype.a, typeof ByTypeof.b, ByTypeof.length, ByTypeof.name);
try { ByTypeof(); } catch (e) { say(e instanceof TypeError); }
try { new ByTypeof.prototype.a(); } catch (e) { say(e instanceof TypeError); }
Promise.resolve(new ByThen()).then(v => { say(v); console.log(out.join("\n")); });
