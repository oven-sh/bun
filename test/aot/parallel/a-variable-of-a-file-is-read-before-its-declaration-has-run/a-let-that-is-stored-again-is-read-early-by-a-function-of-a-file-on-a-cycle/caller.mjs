import { readCount } from "./main.mjs";
try { console.log("caller", readCount()); } catch (error) { console.log("caller threw", error.constructor.name + ":", error.message); }
