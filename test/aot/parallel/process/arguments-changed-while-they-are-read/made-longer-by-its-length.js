// process.argv is made longer by a store to its length, which leaves holes at its end.
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
function first() {
  return typeof process.argv[0];
}
function hasFlag(flag) {
  return process.argv.includes(flag);
}
function whereIs(flag) {
  return process.argv.indexOf(flag);
}
function hasFlagBehind(flag, start) {
  return process.argv.includes(flag, start);
}
function change() {
  process.argv.length += 3;
  process.argv.push("--added");
}
const atStart = process.argv.length;
const seen = [];
for (let i = 0; i < 6; i++) {
  if (i === 3) change();
  const now = attempt(length);
  seen.push(
    [
      now === String(atStart) ? "as at the start" : now - atStart,
      attempt(first),
      attempt(() => hasFlag("--added")),
      attempt(() => whereIs("--added") - atStart),
      attempt(() => hasFlagBehind("--added", 1)),
      attempt(() => hasFlag("--never-given")),
    ].join(" "),
  );
}
console.log(seen.join("\n"));
