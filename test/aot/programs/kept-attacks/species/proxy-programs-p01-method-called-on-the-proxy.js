// Species: proxy programs  method called on the proxy. It prints what plain Bun prints.
class Body { constructor() { this.hits = 0; this.name = "b"; } step() { this.hits++; return this.hits; } who() { return this instanceof Body ? "body" : "other"; } }
const b = new Body(); b.step();
const p = new Proxy(b, {});
console.log(p.step(), b.hits, p.hits, p.who(), p === b, typeof p, p.name);
