export const Timed = (Parent) => class extends Parent { started = 5; #ticks = 0; tick() { return ++this.#ticks + this.started; } static is(value) { return #ticks in value; } };
export function Tagged(Parent) { return class extends Parent { tag = "t"; size() { return this.tag.length + this.id; } }; }
