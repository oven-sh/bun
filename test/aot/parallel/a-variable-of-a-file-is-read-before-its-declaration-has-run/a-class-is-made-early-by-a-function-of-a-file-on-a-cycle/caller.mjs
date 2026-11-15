import { makePoint } from "./main.mjs";
try { console.log("caller", makePoint()); } catch (error) { console.log("caller threw", error.constructor.name + ":", error.message); }
