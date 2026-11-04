function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
export const base = { label: "base", big: make("b") };
const o = Object.create(base);
o.label = "mine";
o.more = make("x");
export const read = () => o;
