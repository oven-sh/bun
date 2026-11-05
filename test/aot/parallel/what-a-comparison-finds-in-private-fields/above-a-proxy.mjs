// Guards: what lists the pattern's names and reads them goes on above a proxy; what asks whether the object has a name ends at one. So a private field above a proxy counts on the pattern's side alone.
class Held { #kept; constructor(v) { this.#kept = v; } kept() { return this.#kept; } }
const below = (v) => Object.create(new Proxy(Object.create(new Held(v)), {}));
console.log(new Held(3).kept(), Bun.deepMatch(below(1), below(1)), Bun.deepMatch(below(1), new Held(2)));
