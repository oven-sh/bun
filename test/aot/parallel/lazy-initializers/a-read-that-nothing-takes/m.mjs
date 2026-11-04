function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

export const o = make("x");
export function touch() { o; return 1; }
export const read = () => o;
