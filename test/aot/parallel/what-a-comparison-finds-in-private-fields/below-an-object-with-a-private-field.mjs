// Guards: Bun.deepMatch() lists and reads through the prototypes, private names too: an object made below an object with a private field is compared by that field.
class Held { #kept; constructor(v) { this.#kept = v; } kept() { return this.#kept; } }
const below = (v) => Object.create(new Held(v));
console.log(new Held(3).kept());
console.log(Bun.deepMatch(below(1), below(2)), Bun.deepMatch(new Held(1), below(1)), Bun.deepMatch(below(1), new Held(2)));
