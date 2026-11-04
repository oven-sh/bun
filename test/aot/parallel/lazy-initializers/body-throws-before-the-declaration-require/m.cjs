function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

const registry = require("./registry.cjs");
registry.push(() => o.title.text);
if (registry.length) throw new Error("stop");
const o = make("late");
exports.read = () => o;
