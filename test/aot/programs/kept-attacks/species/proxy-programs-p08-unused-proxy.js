// Species: proxy programs  unused proxy. It prints what plain Bun prints.
class Body { constructor() { this.hits = 0; } step() { this.hits++; return this; } }
const b = new Body();
new Proxy(b, {});
console.log(b.step().step().hits);
