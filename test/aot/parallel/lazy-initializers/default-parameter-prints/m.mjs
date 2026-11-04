function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

function quiet(t, u = console.log("default runs")) { return make(t); }
const o = quiet("x");
export const read = () => o;
