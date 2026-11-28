import { v } from "./a.cjs";
import { v as w } from "./b.cjs";
import "./deeper.mjs";
import "./mid.mjs";
console.log("late", v, w);
