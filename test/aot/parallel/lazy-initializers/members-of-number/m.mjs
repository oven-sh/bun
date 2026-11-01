function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
function pick() { return { m0: Number.isInteger, m1: Number.parseFloat, m2: Number.isSafeInteger, big: make("x") }; }
const o = pick();
export const read = () => o;
