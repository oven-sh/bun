function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

export function peek() { try { return typeof state; } catch (e) { return e.name; } }
export const seenEarly = peek();
const state = make("late");
export const read = () => state;
