function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
function pick() { return { m0: Reflect.ownKeys, m1: Reflect.has, m2: Reflect.apply, big: make("x") }; }
const o = pick();
export const read = () => o;
