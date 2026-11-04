function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

const f = function () {};
const snap = { seen: f.extra, big: make("x") };
export const read = () => snap;
