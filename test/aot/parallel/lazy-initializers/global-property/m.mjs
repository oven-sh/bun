function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
const o = { seen: [globalThis.setting, typeof setting], big: make("x") };
export const read = () => o;
