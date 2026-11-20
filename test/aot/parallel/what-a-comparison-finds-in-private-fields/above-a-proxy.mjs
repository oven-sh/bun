// Guards: what lists the pattern's names goes on above a proxy, what reads one of them gets undefined from the proxy, and what asks whether the object has a name ends at one. So a private field above a proxy counts on the pattern's side alone, as undefined.
class Held { #kept; constructor(v) { this.#kept = v; } kept() { return this.#kept; } }
const below = (v) => Object.create(new Proxy(Object.create(new Held(v)), {}));
console.log(new Held(3).kept(), Bun.deepMatch(below(1), below(1)), Bun.deepMatch(below(1), new Held(2)), Bun.deepMatch(below(1), new Held(1)), Bun.deepMatch(below(undefined), new Held(undefined)));
