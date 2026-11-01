function make(title) { return { title: { text: title }, list: [1, 2, 3], nested: { a: { b: { c: title } } } }; }
import { cfg } from "./cfg.mjs";
const o = { seen: [Object.isFrozen(cfg), Object.keys(cfg).length, "late" in cfg], big: make("x") };
export const read = () => o;
