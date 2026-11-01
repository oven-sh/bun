function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
import { level } from "./level.mjs";
const o = { seen: [level], big: make("x") };
export const read = () => o;
