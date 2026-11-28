import v from "./p.json";
import "./mid.mjs";
import "./helper.cjs";
import { v as a } from "./a.mjs";
import "./late.mjs";
console.log("root", typeof v === "string" ? v.trim() : typeof v, a);
