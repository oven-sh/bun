function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

import { cfg } from "./a.mjs";
const holder = { held: cfg, more: make("m"), again: make("n") };
export const readB = () => holder;
