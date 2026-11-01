function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
import { reg } from "./reg.mjs";
const o = { big: make("x"), more: make("y") };
reg.name = "set at the import";
export const read = () => o;
