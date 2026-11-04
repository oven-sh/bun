function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
const beside = make("beside");
export const readBeside = () => beside;

const f = function () { return 1; };
f.extra = { a: 1 };
f.other = { a: 2 };
f.third = { a: 3 };
export const read = () => f;
