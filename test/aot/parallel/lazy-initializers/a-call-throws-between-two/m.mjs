function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

import { registry, check } from "./registry.mjs";
registry.push(() => first.title.text, () => second.title.text);
const first = make("first");
check(registry.length);
const second = make("second");
export const read = () => [first, second];
