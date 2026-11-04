function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
function pick() { return { m0: Math.hypot, m1: Math.cbrt, m2: Math.clz32, big: make("x") }; }
const o = pick();
export const read = () => o;
