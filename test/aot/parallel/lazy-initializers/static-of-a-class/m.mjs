function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
import { K } from "./k.mjs";
const o = { seen: [K.level, new K().v], big: make("x") };
export const read = () => o;
