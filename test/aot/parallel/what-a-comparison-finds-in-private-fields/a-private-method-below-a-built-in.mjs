// Guards: an object that is no compiled object bears the mark of a compiled class with private names as a property under a private symbol. Bun.deepMatch() listed the mark, which plain Bun does not have.
class Mine extends Map { shown = 1; #method() { return 1; } call() { return this.#method(); } }
class Other extends Map { shown = 1; }
console.log(new Mine().call(), Bun.deepMatch(new Mine(), new Mine()), Bun.deepMatch(new Mine(), new Other()), Bun.deepMatch(new Other(), new Mine()));
