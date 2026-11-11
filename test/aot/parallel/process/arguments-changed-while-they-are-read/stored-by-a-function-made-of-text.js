// process.argv is overwritten by a function that is made of text at run time.
// DECLARED: docs/compiler/compatibility.mdx, "Built-in objects are read-only". A written text is unseen code, so the build does not see the store, and the lock on process.argv refuses it. `bun <file>` and `bun build --compile` store.
function attempt(read) {
  try {
    return String(read());
  } catch (error) {
    return error.constructor.name;
  }
}
function length() {
  return process.argv.length;
}
function third() {
  return typeof process.argv[2];
}
function first() {
  return typeof process.argv[0];
}
function hasFlag(flag) {
  return process.argv.includes(flag);
}
function change() {
  new Function("list", "process.argv = list")(new Set(["--added"]));
}
const atStart = process.argv.length;
const seen = [];
for (let i = 0; i < 6; i++) {
  if (i === 3) change();
  const now = attempt(length);
  seen.push([now === String(atStart) ? "as at the start" : now, attempt(first), attempt(third), attempt(() => hasFlag("--added")), typeof process.argv, Array.isArray(process.argv)].join(" "));
}
console.log(seen.join("\n"));
/* Output:
exit code 1
TypeError: Cannot assign to process.argv because built-in objects are read-only in a compiled executable, and the build didn't see your code assign to this one. Spell out the object and the name where it does, as in process.argv = value (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
*/
