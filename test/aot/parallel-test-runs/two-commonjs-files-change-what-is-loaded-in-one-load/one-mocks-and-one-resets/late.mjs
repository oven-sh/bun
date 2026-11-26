import { v } from "./a.mjs";
import { v as w } from "./b.mjs";
import "./deeper.mjs";
import "./mid.mjs";
console.log("late", v, w);
