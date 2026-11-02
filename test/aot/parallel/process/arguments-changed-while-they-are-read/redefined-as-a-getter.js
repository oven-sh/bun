// process.argv is redefined as a getter that answers something else at every read.
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
  let reads = 0;
  Object.defineProperty(process, "argv", { get: () => (reads++ % 2 ? [1, 2, 3] : { length: "long", 0: null }), configurable: true });
}
const atStart = process.argv.length;
const seen = [];
for (let i = 0; i < 6; i++) {
  if (i === 3) change();
  const now = attempt(length);
  seen.push([now === String(atStart) ? "as at the start" : now, attempt(first), attempt(third), attempt(() => hasFlag("--added")), typeof process.argv, Array.isArray(process.argv)].join(" "));
}
console.log(seen.join("\n"));
