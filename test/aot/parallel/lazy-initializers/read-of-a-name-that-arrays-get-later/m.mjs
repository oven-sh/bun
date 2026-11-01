function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

const a = [1, 2];
const snap = { seen: a.extra, big: make("x") };
export const read = () => snap;
