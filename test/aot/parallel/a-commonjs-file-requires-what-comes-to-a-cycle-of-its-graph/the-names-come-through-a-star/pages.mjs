import { frame } from "./all.mjs";
console.log("pages");
export let seen = "not run";
try { seen = frame(); } catch (error) { seen = error.name; }
