// A class constructor calls a method off `this` before it stores its fields. The method names only fields that no birth fills.
// STATISTIC: UnfinishedObjectsAdmitted >= 1
const log = [];
const show = o => Object.keys(o).join() + " " + JSON.stringify(o);
class Fiber {
  constructor(context, flag = true) {
    this.setContext(context);
    this.id = ++Fiber.ids; this.count = 0; this.flag = flag; this.stack = []; this.observers = undefined; this.exit = undefined; this.running = false;
    log.push(this.cache.kind);
  }
  setContext(context) {
    const previous = this.context;
    this.context = context;
    if (previous !== undefined && previous === context) return;
    if (this.cache?.kind !== context.kind) this.dispatcher = undefined;
    this.cache = context;
  }
  static ids = 0;
}
class Above { constructor(n) { this.init(n); this.n = n; this.text = "t" + n; } init(n) { this.late = n; this.more = this.late ? this.more ?? n : "none"; } }
class Below extends Above { constructor(n) { super(n); this.own = n; this.init(n + 1); } init(n) { super.init(n); this.deep = (this.deep ?? 0) + n; } }
class WithAccessor { constructor(n) { this.set(n); this.n = n; this.m = n; } set(n) { const before = this.value; this.value = n; log.push(String(before)); } }
class Leaks { constructor(n, keep) { keep(this, n); this.note(n); this.n = n; this.o = { n }; } note(n) { const had = this.mark; this.mark = had === undefined ? n : had + n; } }
class Throws { constructor(n) { try { this.fill(n); } catch (error) { this.message = error.message; } this.n = n; this.m = n; } fill(n) { const had = this.before; this.before = n; if (n === 2) throw new Error("two" + had); this.behind = this.before; } }
const contexts = [{ kind: "a" }, { kind: "b", n: 1 }, { kind: "a", m: 2 }];
for (let turn = 0; turn < 4; turn++) {
  const rows = [];
  for (let n = 0; n < 24; n++) {
    const fiber = new Fiber(contexts[n % 3], n & 1);
    if (n % 5 === 0) fiber.setContext(contexts[(n + 1) % 3]);
    if (n % 7 === 0) { fiber.setContext(fiber.context); delete fiber.dispatcher; fiber.setContext({ kind: "z" }); }
    if (n % 11 === 3) { Object.freeze(fiber); try { fiber.setContext({ kind: "f" }); } catch (error) { rows.push(error.constructor.name); } }
    if (n % 11 === 5) { Object.defineProperty(fiber, "context", { get() { return contexts[2]; }, set(v) { log.push("set " + v.kind); }, configurable: true }); fiber.setContext(contexts[1]); }
    if (n % 11 === 7) { Object.setPrototypeOf(fiber, { setContext: Fiber.prototype.setContext, get cache() { return { kind: "above" }; }, set cache(v) { log.push("cache " + v.kind); } }); delete fiber.cache; fiber.setContext(contexts[0]); }
    const others = [new Above(n), new Below(n), new WithAccessor(n), new Leaks(n, (o, m) => { if (m % 3 === 0) o.mark = 100; if (m % 4 === 0) Object.defineProperty(o, "mark", { get() { return 5; }, set() {}, configurable: true }); }), new Throws(n % 4)];
    if (n % 6 === turn) rows.push(show(fiber), ...others.map(show));
    if (n === 20 && turn === 1) Object.defineProperty(WithAccessor.prototype, "value", { get() { return "proto"; }, set(v) { log.push("proto " + v); }, configurable: true });
    if (n === 20 && turn === 2) Fiber.prototype.context = { kind: "proto" };
  }
  console.log(turn, rows.join("\n"), log.splice(0).join());
}
for (const value of [null, undefined, 1, "text", {}, Object.freeze({}), [1]]) { try { Fiber.prototype.setContext.call(value, contexts[0]); console.log(JSON.stringify(value)); } catch (error) { console.log(error.constructor.name); } }
