import { v } from "./dep.mjs";
import "./helper.mjs";
import "./mid.mjs";
import "./z.cjs";
console.log("root", typeof v === "string" ? v.trim() : typeof v);
