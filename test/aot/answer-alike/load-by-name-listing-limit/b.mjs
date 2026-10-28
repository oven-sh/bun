// a.mjs and one more copy of the own values of process, of which nothing is called.
const never = process.argv.length > 99;
const glue = (...parts) => parts.join(never ? "x" : "");
setTimeout(u => {
  let answer;
  try { answer = typeof ({ ...u })[glue("g", "etBuiltinModule")]("node:path").join; } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 23); }
  const other = Object.assign({}, u)[glue("e", "xitCode")];
  console.log(answer, other === undefined ? "" : "");
}, 0, process);
