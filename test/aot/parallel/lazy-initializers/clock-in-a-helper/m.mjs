function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
function stamped() { return { at: Date.now(), r: Math.random(), big: make("x") }; }
const o = stamped();
export const read = () => o;
export const loadedAt = Date.now();
