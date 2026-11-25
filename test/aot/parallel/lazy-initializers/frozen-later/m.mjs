function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
const beside = make("beside");
export const readBeside = () => beside;

const o = { a: { b: { c: { d: { e: 1 } } } } };
o.toString = () => "mine";
o.valueOf = () => 7;
o.constructor = 5;
export const read = () => o;
