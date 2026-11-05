// process.argv gets another prototype, whose includes answers otherwise and which has a third element.
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
  Object.setPrototypeOf(process.argv, { includes: () => "from the prototype", 2: 4 });
}
const atStart = process.argv.length;
const seen = [];
for (let i = 0; i < 6; i++) {
  if (i === 3) change();
  const now = attempt(length);
  seen.push([now === String(atStart) ? "as at the start" : now, attempt(first), attempt(third), attempt(() => hasFlag("--added")), typeof process.argv, Array.isArray(process.argv)].join(" "));
}
console.log(seen.join("\n"));
