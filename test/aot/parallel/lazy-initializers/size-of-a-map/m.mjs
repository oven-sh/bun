function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
import { map } from "./map.mjs";
const o = { seen: [map.size, map.get("a")], big: make("x") };
export const read = () => o;
