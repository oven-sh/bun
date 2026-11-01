function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
import { F } from "./f.mjs";
const o = { seen: [], made: new F(), big: make("x") };
export const read = () => o;
