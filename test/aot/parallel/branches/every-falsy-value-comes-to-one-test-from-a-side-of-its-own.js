// each falsy value, and its truthy neighbor, comes to one test from a side of its own
function subject(which) {
  const v = which === 0 ? 0 : which === 1 ? -0 : which === 2 ? NaN : which === 3 ? "" : which === 4 ? null : which === 5 ? undefined : which === 6 ? false : which === 7 ? 0n
    : which === 8 ? "0" : which === 9 ? -1 : which === 10 ? " " : which === 11 ? 1n : which === 12 ? [] : which === 13 ? Infinity : last;
  if (v) return "truthy";
  return "falsy";
}
var last = { valueOf() { return 0; }, toString() { return ""; } };
function deed(from, to) { let out = ""; for (let which = from; which < to; which++) out += subject(which)[0]; return out; }
console.log(deed(0, 15));
let truthy = 0;
for (let i = 0; i < 300; i++) truthy += subject(i % 15) === "truthy" ? 1 : 0;
console.log(String(truthy));
last = 0;
console.log(deed(JSON.parse("12"), 15));
