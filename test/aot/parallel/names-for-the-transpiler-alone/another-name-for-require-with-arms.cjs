// Guards: the transpiler reads a name under the require as written alone, and in no dead arm.
const flag = process.argv.length > 99 ? 1 : 0;
const load = require;
try { console.log(typeof load(flag ? "path" : "bun:os").cpus); } catch (e) { console.log(e.code); }
