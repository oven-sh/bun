// Species: proxy programs  revocable and nested. It prints what plain Bun prints.
const log = [];
class Body { constructor() { this.hits = 1; } step() { return ++this.hits; } }
const b = new Body();
const { proxy, revoke } = Proxy.revocable(b, { get(t, k, r) { log.push("outer " + String(k)); return Reflect.get(t, k, r); } });
const nested = new Proxy(proxy, {});
log.push(String(nested.step()), String(b.hits));
revoke();
try { nested.hits; } catch (error) { log.push(error.constructor.name); }
console.log(log.join("; "));
