function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
export const base = { label: "base", big: make("b") };
const o = { __proto__: base, more: make("x") };
o.label = "mine";
o.other = make("y");
export const read = () => o;
