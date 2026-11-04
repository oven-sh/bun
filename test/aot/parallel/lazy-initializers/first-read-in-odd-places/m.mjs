function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

const a = make("a"), b = make("b"), c = make("c"), d = make("d"), e = make("e"), f = make("f");
export const inGetter = { get v() { return a.title.text; } };
export function* inGenerator() { yield b.title.text; }
export async function inAsync() { await null; return c.title.text; }
export const inProxy = new Proxy({}, { get() { return d.title.text; } });
export const inToJSON = { toJSON() { return e.title.text; } };
export const inComparator = (x, y) => f.list[0] * (x - y);
