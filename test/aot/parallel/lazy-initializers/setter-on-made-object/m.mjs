function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

const o = { set v(x) { console.log("setter runs"); }, big: make("x") };
o.v = 1;
export const read = () => o;
