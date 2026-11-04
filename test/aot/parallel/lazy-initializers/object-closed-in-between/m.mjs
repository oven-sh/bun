function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
function pick() { return { m0: Object.entries, m1: Object.fromEntries, m2: Object.groupBy, big: make("x") }; }
const o = pick();
export const read = () => o;
