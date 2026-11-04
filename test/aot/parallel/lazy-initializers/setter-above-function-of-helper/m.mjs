function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
const beside = make("beside");
export const readBeside = () => beside;

function tagged(tag) { const f = function () { return tag; }; f.tag = { text: tag }; f.extra = { a: 1 }; return f; }
const f = tagged("x");
export const read = () => f;
