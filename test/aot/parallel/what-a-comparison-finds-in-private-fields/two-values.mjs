// Guards: Bun.deepMatch() compares private fields too. An object of a compiled class shows native code no private name, so two objects that differ in a private field alone matched.
class Held { shown = 1; #kept; constructor(kept) { this.#kept = kept; } }
console.log(Bun.deepMatch(new Held(2), new Held(1)), Bun.deepMatch(new Held(1), new Held(1)), Bun.deepMatch(new Held("a"), new Held("b")), Bun.deepMatch(new Held(1), { shown: 1 }), Bun.deepMatch({ shown: 1 }, new Held(1)));
