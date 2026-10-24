// Species: proxy programs  private fields and brands. It prints what plain Bun prints.
const log = [];
class Body { #secret = 1; static has(o) { return #secret in o; } peek() { return this.#secret; } }
const b = new Body(); const p = new Proxy(b, {});
log.push(String(Body.has(b)), String(Body.has(p)));
try { p.peek(); } catch (error) { log.push(error.constructor.name); }
try { Map.prototype.get.call(new Proxy(new Map(), {}), 1); } catch (error) { log.push(error.constructor.name); }
console.log(log.join("; "));
