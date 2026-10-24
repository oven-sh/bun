// The program copies the own values of process and calls getBuiltinModule, found under a computed name in the copy.
const never = process.argv.length > 99;
const glue = (...parts) => parts.join(never ? "x" : "");
setTimeout(u => {
  let answer;
  try { answer = typeof ({ ...u })[glue("g", "etBuiltinModule")]("node:path").join; } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 23); }
  console.log(answer);
}, 0, process);
