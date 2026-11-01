function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

const label = { toString() { console.log("toString runs"); return "L"; } };
const o = { text: "" + label, big: make("x") };
export const read = () => o;
