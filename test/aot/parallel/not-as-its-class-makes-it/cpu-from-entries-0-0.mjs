// Own value 0 of what is made (cpu) comes out by from entries.
import os from "node:os";
function use(e) { return typeof e; }
const m = os.cpus()[0];
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
