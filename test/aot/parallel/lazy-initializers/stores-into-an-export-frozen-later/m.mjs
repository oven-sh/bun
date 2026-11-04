function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
import { reg } from "./reg.mjs";
const o = make("x");
reg.held = o;
reg.seen = 1;
export const read = () => o;
