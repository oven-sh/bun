// Guards: what lies in a private field is compared as what lies in a public one: an object there is gone into, by the names of the pattern.
class Held { #kept; constructor(kept) { this.#kept = kept; } }
console.log(Bun.deepMatch(new Held({ a: 1 }), new Held({ a: 1, b: 2 })), Bun.deepMatch(new Held({ a: 1, b: 2 }), new Held({ a: 1 })), Bun.deepMatch(new Held(new Held(1)), new Held(new Held(1))), Bun.deepMatch(new Held(new Held(1)), new Held(new Held(2))), Bun.deepMatch(new Held([1, 2]), new Held([1, 2])), Bun.deepMatch(new Held([1]), new Held([1, 2])));
