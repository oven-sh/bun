function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

import { cfg } from "./cfg.mjs";
const o = { title: cfg.name, deep: cfg.nested.n, big: make("x") };
export const read = () => o;
