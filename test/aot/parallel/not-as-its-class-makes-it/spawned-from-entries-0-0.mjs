// Own value 0 of what is made (spawned) comes out by from entries.
import child from "node:child_process";
function use(e) { return typeof e; }
const m = child.spawnSync("true");
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
