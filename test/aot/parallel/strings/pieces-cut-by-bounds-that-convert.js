// the bounds of slice, substring and substr are objects that convert in their order, texts, null, undefined, booleans, and one that throws behind the first
const log = [];
function bound(name, value) {
  return { valueOf() { log.push(name); return value; } };
}
function pieces(s, a, b) {
  return [s.slice(a, b), s.substring(a, b), s.substr(a, b)].join(",");
}
function tell(s, a, b) {
  try {
    return pieces(s, a, b);
  } catch (e) {
    return e.name;
  }
}
function deed() {
  const thrower = { valueOf() { log.push("throws"); throw new TypeError("no bound"); } };
  return [
    tell("abcdef", bound("a", 1), bound("b", 4)),
    tell("abcdef", "1", "4"),
    tell("abcdef", null, undefined),
    tell("abcdef", undefined, null),
    tell("abcdef", true, "x"),
    tell("abcdef", bound("first", 2), thrower),
    tell("abcdef", thrower, bound("never", 2)),
    tell("abcdef", -0, 1.9),
    tell("abcdef", 4, 1),
  ].join(" | ");
}
console.log(deed());
for (let i = 0; i < 30; i++) deed();
console.log(deed());
console.log(log.length, log.slice(0, 12).join());
