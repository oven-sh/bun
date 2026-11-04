function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

const f = function () {};
const a = [1, 2];
const snap = { seen: ["extra" in f, "extra" in a], big: make("x") };
export const read = () => snap;
