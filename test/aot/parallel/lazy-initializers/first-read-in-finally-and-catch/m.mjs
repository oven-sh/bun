function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

const a = make("a"), b = make("b");
export function run() { try { throw new Error("x"); } catch (e) { return a.title.text + e.message; } finally { console.log(b.title.text); } }
