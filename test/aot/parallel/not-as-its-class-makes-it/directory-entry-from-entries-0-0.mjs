// Own value 0 of what is made (directory entry) comes out by from entries.
import fs from "node:fs";
function use(e) { return typeof e; }
const m = fs.readdirSync("/", { withFileTypes: true })[0];
try { console.log(use(Object.values(Object.fromEntries(Object.entries(m)))[0])); } catch (error) { console.log(error.constructor.name); }
