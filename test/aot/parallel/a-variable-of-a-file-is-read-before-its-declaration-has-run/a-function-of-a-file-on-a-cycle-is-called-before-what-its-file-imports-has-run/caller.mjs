import { readLimit } from "./main.mjs";
try { console.log("caller", readLimit()); } catch (error) { console.log("caller threw", error.constructor.name + ":", error.message); }
