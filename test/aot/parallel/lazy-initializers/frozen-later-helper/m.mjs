function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
const beside = make("beside");
export const readBeside = () => beside;

function named(text) { const o = {}; o.text = text; o.toString = () => text; return o; }
const byArrow = () => { const o = { a: 1 }; o.toString = () => "of the arrow"; return o; };
const o = named("mine");
const p = byArrow();
export const read = () => o;
export const readArrow = () => p;
