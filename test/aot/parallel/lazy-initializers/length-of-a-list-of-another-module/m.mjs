function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
import { list } from "./list.mjs";
const o = { seen: [list.length, list[0]], big: make("x") };
export const read = () => o;
