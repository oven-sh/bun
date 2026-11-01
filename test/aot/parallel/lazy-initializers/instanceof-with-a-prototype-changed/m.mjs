function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
import { F, it } from "./f.mjs";
const o = { seen: [it instanceof F], big: make("x") };
export const read = () => o;
