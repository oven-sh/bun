// the position of charCodeAt, charAt, at and codePointAt is an object that converts, a text, null, undefined, a boolean, a BigInt, a symbol
const log = [];
function reads(s, p) {
  return [s.charCodeAt(p), s.charAt(p), s.at(p), s.codePointAt(p)].map(String).join(",");
}
function tell(s, p) {
  try {
    return reads(s, p);
  } catch (e) {
    return e.name + ": " + e.message;
  }
}
function deed() {
  const counted = { valueOf() { log.push("valueOf"); return 1; }, toString() { log.push("toString"); return "2"; } };
  const thrower = { valueOf() { log.push("throws"); throw new RangeError("no position"); } };
  const positions = [1, counted, "1", "x", "", null, undefined, true, [2], {}, thrower, 1n, Symbol("p")];
  const out = [];
  for (let i = 0; i < positions.length; i++) out.push(tell("abĀd", positions[i]));
  return out.join(" | ");
}
console.log(deed());
for (let i = 0; i < 30; i++) deed();
console.log(deed());
console.log(log.length, log.slice(0, 6).join());
