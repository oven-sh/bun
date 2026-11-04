// indexOf, includes and lastIndexOf of a written text begin at -1, NaN, 1.5, the length, behind it, the infinities, and at a position that converts
function from(s, p) {
  return [s.indexOf("b", p), s.indexOf("bc", p), s.includes("bc", p), s.lastIndexOf("b", p), s.lastIndexOf("bc", p), s.indexOf("", p), s.lastIndexOf("", p), s.startsWith("bc", p), s.endsWith("bc", p)].join(",");
}
function deed() {
  const positions = [-1, 0, 1, 1.5, 2, 5, 6, 7, NaN, Infinity, -Infinity, 2 ** 31, -(2 ** 31) - 1, "1", null, undefined, { valueOf: () => 4 }];
  const out = [];
  for (let i = 0; i < positions.length; i++) out.push(from("abcabc", positions[i]) + ";" + from("Ābc", positions[i]));
  return out.join(" ");
}
console.log(deed());
for (let i = 0; i < 30; i++) deed();
console.log(deed());
