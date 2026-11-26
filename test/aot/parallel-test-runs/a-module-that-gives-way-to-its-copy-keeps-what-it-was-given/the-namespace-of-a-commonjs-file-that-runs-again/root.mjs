import * as ns from "./p.cjs";
import { ofMid } from "./mid.mjs";
import { h } from "./helper.cjs";
import { v as a } from "./a.cjs";
import "./z.cjs";
const v = ns.v,
  bump = () => {};
console.log("root", typeof v === "string" ? v.trim() : typeof v, h, typeof a === "object" ? "obj" : a, a === ofMid);
bump();
console.log("bumped", typeof v === "string" ? v.trim() : typeof v);
