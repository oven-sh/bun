// `new` of classes that extend built-ins, classes of the program and functions; constructors that return another object of their class or nothing; what `super(..)` yields is `this`.

const lines: string[] = [];
function say(...parts: unknown[]) { lines.push(parts.map(part => typeof part === "object" && part !== null && !(part instanceof Error) ? JSON.stringify(part) : String(part)).join(" ")); }

class AppError extends Error { code: number; constructor(message: string, code: number) { super(message); this.code = code; this.name = "AppError"; } }
class NotFound extends AppError { what: string; constructor(what: string) { super(what + " not found", 404); this.what = what; } }
class Bag extends Map<string, number> { total(): number { let n = 0; for (const v of this.values()) n += v; return n; } }
class Stack extends Array<number> { top(): number | undefined { return this[this.length - 1]; } }
class Tags extends Set<string> { constructor(...tags: string[]) { super(tags); } joined(): string { return [...this].join(); } }
class Base { kind = "base"; constructor(public id: number) {} }
class Derived extends Base { extra: string; constructor(id: number, extra: string) { super(id + 1); this.extra = extra; } }
class Silent extends Base {}
class Cached { static last: Cached | undefined = undefined; uses = 0; constructor(reuse: boolean) { if (reuse && Cached.last) { Cached.last.uses++; return Cached.last; } Cached.last = this; } }
class CachedBelow extends Cached { more = 2; constructor(reuse: boolean) { super(reuse); this.more++; } }

function fail(what: string): AppError { return new NotFound(what); }
function make<T>(build: new (id: number) => T, id: number): T { return new build(id); }

const e = fail("file");
say(e.message, e.code, e.name, (e as NotFound).what, e instanceof NotFound, e instanceof AppError, e instanceof Error, Object.prototype.toString.call(e));
const bag = new Bag(); bag.set("a", 1).set("b", 2);
say(bag.total(), bag.size, bag instanceof Map, bag instanceof Bag);
const stack = new Stack(); stack.push(4, 5, 6);
say(stack.top(), stack.length, Array.isArray(stack), stack.map(n => n * 2) instanceof Stack, (stack.slice(1) as Stack).top());
const tags = new Tags("x", "y", "x");
say(tags.joined(), tags.size, tags.has("y"));
say(new Derived(1, "d"), new Silent(7), new Base(2), make(Base, 3), make(Silent, 4).kind);
const one = new Cached(false);
say(one, new Cached(true) === one, new Cached(true).uses, new Cached(false) === one);
const below = new CachedBelow(false);
say(below, new CachedBelow(true) === below, below.more, below.uses);
try { throw new NotFound("key"); } catch (error) { say(error instanceof AppError ? error.code : -1, String(error)); }
let total = 0;
for (let i = 0; i < 3000; i++) { const d = new Derived(i, "x"); const err = new AppError("m", i); const b = new Bag(); b.set("k", i); total += d.id + err.code + b.total() + new Silent(i).id; }
say(total);
console.log(lines.join("\n"));
