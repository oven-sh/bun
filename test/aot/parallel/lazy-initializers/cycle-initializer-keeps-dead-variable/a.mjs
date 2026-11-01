function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }

import { readB } from "./b.mjs";
export const cfg = make("cfg of a");
export const later = () => readB();
