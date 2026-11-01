function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
const beside = make("beside");
export const readBeside = () => beside;

const f = function () { return 1; };
f.toString = () => "mine";
f.call = () => "called";
f.extra = { a: 1 };
const g = () => 1;
g.toString = () => "of the arrow";
g.bind = 5;
g.more = { a: 1 };
export const read = () => f;
export const readArrow = () => g;
