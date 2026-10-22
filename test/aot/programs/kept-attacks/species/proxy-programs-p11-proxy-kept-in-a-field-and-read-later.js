// Species: proxy programs  proxy kept in a field and read later. It prints what plain Bun prints.
const log = [];
class Body { constructor(n) { this.hits = n; } }
class Holder { constructor(view) { this.view = view; } read() { return this.view.hits; } write(v) { this.view.hits = v; } }
const b = new Body(1);
const h = new Holder(new Proxy(b, {}));
log.push(String(h.read())); h.write("s"); log.push(typeof b.hits, String(new Holder(new Body(5)).read()));
console.log(log.join("; "));
