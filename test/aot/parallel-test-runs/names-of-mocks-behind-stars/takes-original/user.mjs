import * as ns from "./shapes.mjs";
import * as bar from "./barrel.mjs";
import { b } from "./barrel.mjs";
import * as two from "./two.mjs";
export const look = () => [Object.keys(ns).join(), "a" in ns, "c" in ns, Object.keys(bar).join(), "a" in bar, "c" in bar, String(bar.a), String(bar.c), String(b), Object.keys(two).join(), String(two.a), String(two.c)].join(" | ");
