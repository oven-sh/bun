function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

const p = new Proxy({}, { get(t, k) { console.log("trap", String(k)); return 1; } });
const o = { v: p.x, big: make("x") };
export const read = () => o;
