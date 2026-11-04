function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

const src = { get v() { console.log("getter runs"); return 1; } };
const o = { ...src, big: make("x") };
export const read = () => o;
