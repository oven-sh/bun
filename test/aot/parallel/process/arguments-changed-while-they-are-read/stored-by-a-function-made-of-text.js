// process.argv is overwritten by a function that is made of text at run time.
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
