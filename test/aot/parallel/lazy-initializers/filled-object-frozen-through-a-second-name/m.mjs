function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
const inner = {};
const outer = { inner, big: make("x") };
inner.a = { v: 1 };
inner.b = { v: 2 };
inner.c = { v: 3 };
export const readOuter = () => outer;
export const readInner = () => inner;
