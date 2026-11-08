// Guards: Bun's transpiler lowers a decorated private field to a WeakMap, which nobody lists: no comparison sees it.
const marks = (value: undefined, context: ClassFieldDecoratorContext) => undefined;
class Held { @marks #kept: number; constructor(kept: number) { this.#kept = kept; } read() { return this.#kept; } }
console.log(new Held(3).read(), Bun.deepMatch(new Held(1), new Held(2)), Bun.deepMatch(new Held(1), new Held(1)));
