function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

import "./setup.mjs";
const f = function () {};
const a = [1];
const snap = { seen: [f.extra, a.extra], big: make("x") };
export const read = () => snap;
