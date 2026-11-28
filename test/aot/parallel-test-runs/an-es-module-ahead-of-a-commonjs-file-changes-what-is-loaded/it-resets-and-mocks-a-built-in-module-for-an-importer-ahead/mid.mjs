import { platform as v } from "node:os";
console.log("mid", typeof v === "string" ? v.trim() : typeof v);
