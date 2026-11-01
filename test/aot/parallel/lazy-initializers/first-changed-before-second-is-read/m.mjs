function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

const base = make("base");
const upper = { below: base, text: base.title.text, own: make("upper") };
export const readUpper = () => upper;
export const readBase = () => base;
