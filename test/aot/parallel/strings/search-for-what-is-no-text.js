// startsWith, endsWith, includes, indexOf and lastIndexOf are handed a RegExp (throws), an object with Symbol.match set to false, an object that converts, null, undefined, a number
const log = [];
function searches(s, t) {
  return [s.startsWith(t), s.endsWith(t), s.includes(t), s.indexOf(t), s.lastIndexOf(t)].join(",");
}
function tell(s, t) {
  try {
    return searches(s, t);
  } catch (e) {
    return e.name;
  }
}
function deed() {
  const pattern = /a/;
  const disarmed = /a/;
  disarmed[Symbol.match] = false;
  const converts = { toString() { log.push("toString"); return "null"; } };
  const values = ["nu", pattern, disarmed, converts, null, undefined, 1, [], ["u", "l"]];
  const out = [];
  for (let i = 0; i < values.length; i++) out.push(tell("null/a/undefined1u,l", values[i]));
  return out.join(" | ");
}
console.log(deed());
for (let i = 0; i < 30; i++) deed();
console.log(deed());
console.log(log.length);
