// Guards: two evaluations of one class expression have a private name each, so an object of the one lacks the field of the other.
const make = () => class { shown = 1; #kept; constructor(kept) { this.#kept = kept; } };
const [First, Second] = [make(), make()];
console.log(Bun.deepMatch(new First(1), new Second(1)), Bun.deepMatch(new First(1), new First(1)), Bun.deepMatch(new First(1), new First(2)));
