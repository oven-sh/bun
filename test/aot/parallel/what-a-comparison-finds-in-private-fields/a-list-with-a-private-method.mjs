// Guards: two lists match only if they have as many names. The mark of a compiled class with private methods on a list is no name that plain Bun has.
class Mine extends Array { #method() { return 1; } call() { return this.#method(); } }
console.log(new Mine().call(), Bun.deepMatch(new Mine(), []), Bun.deepMatch([], new Mine()), Bun.deepMatch(new Mine(), new Mine()));
