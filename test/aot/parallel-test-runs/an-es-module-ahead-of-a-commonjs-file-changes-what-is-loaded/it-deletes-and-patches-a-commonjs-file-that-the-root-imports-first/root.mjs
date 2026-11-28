import { v } from "./dep.cjs";
import "./helper.mjs";
import "./mid.mjs";
import "./z.cjs";
console.log("root", typeof v === "string" ? v.trim() : typeof v);
