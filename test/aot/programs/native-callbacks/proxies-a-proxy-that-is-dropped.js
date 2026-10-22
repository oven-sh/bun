// A proxy that nobody keeps: its target goes on as if it had not been made.
class Body { constructor() { this.hits = 0; } step() { this.hits++; return this; } }
const b = new Body();
new Proxy(b, {});
console.log(b.step().step().hits);
