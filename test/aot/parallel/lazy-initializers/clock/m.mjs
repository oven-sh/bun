function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
const o = { seen: [], at: performance.now(), big: make("x") };
export const read = () => o;
export const loadedAt = performance.now();
