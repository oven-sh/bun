import v from "./p.json" with { type: "text" };
import { ofMid } from "./mid.mjs";
import { h } from "./helper.cjs";
import { v as a } from "./a.json";
import "./z.cjs";
const bump = () => {};
console.log("root", typeof v === "string" ? v.trim() : typeof v, h, typeof a === "object" ? "obj" : a, a === ofMid);
bump();
console.log("bumped", typeof v === "string" ? v.trim() : typeof v);
