function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

function log(x) { console.log("static runs"); return x; }
class C { static x = log(1); static big = make("x"); }
export const read = () => ({ x: C.x });
