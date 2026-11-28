import { v, bump } from "./re.mjs";
import { ofMid } from "./mid.mjs";
import { h } from "./sub.mjs";
import { v as a } from "./a.mjs";
import "./z.cjs";
console.log("root", typeof v === "string" ? v.trim() : typeof v, h, typeof a === "object" ? "obj" : a, a === ofMid);
bump();
console.log("bumped", typeof v === "string" ? v.trim() : typeof v);
