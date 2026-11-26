import { v } from "./p.cjs";
import "./mid.mjs";
import "./helper.cjs";
import { v as a } from "./a.mjs";
import "./late.mjs";
import "./z.cjs";
console.log("root", typeof v === "string" ? v.trim() : typeof v, a);
