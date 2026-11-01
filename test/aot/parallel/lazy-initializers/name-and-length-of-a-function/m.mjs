function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
import { f } from "./f.mjs";
const o = { seen: [f.name, f.length, f.tag], big: make("x") };
export const read = () => o;
