// Own value 0 of what is made (parsed path) comes out by from entries.
import path from "node:path";
function use(e) { return typeof e; }
const m = path.parse("/a/b.c");
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
