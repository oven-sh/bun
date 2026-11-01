function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

function loud(t) { console.log("helper runs"); return make(t); }
const o = loud("x");
export const read = () => o;
