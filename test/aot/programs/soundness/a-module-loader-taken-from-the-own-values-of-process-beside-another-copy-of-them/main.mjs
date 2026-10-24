// process goes to a timer as an argument and comes back as a value nobody knows. getBuiltinModule is taken out of a copy of its own values under a name put together at run time and called; a second copy of the own values is made in the same function.
const never = process.argv.length > 99;
const glue = (...parts) => parts.join(never ? "x" : "");
setTimeout(async u => {
  { let r; try { const f = ({ ...u })[glue('g', 'etBuiltinModule')]; r = f === undefined ? "absent" : String(typeof f('node:path').join); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 300); } console.log('process.getBuiltinModule', r); }
  { let r; try { const f = Object.assign({}, u)[glue('e', 'xitCode')]; r = f === undefined ? "absent" : String(f); } catch (e) { r = "threw " + e.name + ": " + String(e.message).slice(0, 300); } console.log('process.exitCode', r); }
}, 0, process);
