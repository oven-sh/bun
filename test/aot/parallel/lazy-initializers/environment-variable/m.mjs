function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
const o = { seen: [process.env.DEFER_PROBE], big: make("x") };
export const read = () => o;
