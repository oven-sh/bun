// where a text is written arrives a String object, an object of a subclass with methods of its own, and an object that only looks like a text
class Loud extends String {
  charAt(i) { return super.charAt(i).toUpperCase(); }
  charCodeAt() { return -7; }
  slice() { return "sliced by the subclass"; }
  get length() { return 99; }
}
function subject(s, i) {
  return [s.charAt(i), s.charCodeAt(i), s[i], s.slice(i), s.length, s.startsWith("b"), s.indexOf("c"), s.charAt(i) === "b", s[i] === "b", s.length === 0].map(String).join(",");
}
function deed() {
  const own = new String("abc");
  own.charAt = () => "own";
  const lookalike = { charAt: i => "like" + i, charCodeAt: () => 1, 1: "one", slice: () => "", length: 0, startsWith: () => "yes", indexOf: () => "no" };
  const values = ["abc", new String("abc"), new Loud("abc"), own, lookalike, Object("bcd")];
  const out = [];
  for (let i = 0; i < values.length; i++) out.push(subject(values[i], 1));
  return out.join(" | ");
}
console.log(deed());
for (let i = 0; i < 30; i++) deed();
console.log(deed());
