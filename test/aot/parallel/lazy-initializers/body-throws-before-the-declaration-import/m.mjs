function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

import { registry } from "./registry.mjs";
registry.push(() => o.title.text);
if (registry.length) throw new Error("stop");
const o = make("late");
export const read = () => o;
