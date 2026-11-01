function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

function probe(x) { return x.extra; }
const snap = { seen: [probe(function () {}), probe([1])], big: make("x") };
export const read = () => snap;
