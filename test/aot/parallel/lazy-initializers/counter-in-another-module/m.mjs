function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
import { next } from "./count.mjs";
const o = { seen: [next()], big: make("x") };
export const read = () => o;
