import { hook } from "./hooks.mjs";
let seen; try { seen = String(hook()); } catch (e) { seen = e.name; }
console.log(seen);
