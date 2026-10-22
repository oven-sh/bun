// Species: proxy programs  store through the proxy. It prints what plain Bun prints.
class Body { constructor() { this.hits = 0; } twice() { return this.hits * 2; } }
const b = new Body();
const p = new Proxy(b, {});
p.hits = "s"; p.extra = 1;
console.log(typeof b.hits, b.twice(), b.extra, Object.keys(b).join());
delete p.hits;
console.log(b.hits, "hits" in b, "hits" in p);
