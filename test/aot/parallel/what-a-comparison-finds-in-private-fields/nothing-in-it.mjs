// Guards: a private field that holds undefined is there, and one that nothing was stored into since its definition holds undefined too.
class Holder { #s; fill(v) { this.#s = v; return this; } }
console.log(Bun.deepMatch(new Holder(), new Holder().fill(1)), Bun.deepMatch(new Holder().fill(1), new Holder()), Bun.deepMatch(new Holder(), new Holder()), Bun.deepMatch(new Holder().fill(undefined), new Holder().fill(null)));
