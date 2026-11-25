function kind(a, b) {
  const name = String(a), extension = String(b);
  if (name.endsWith("." + extension)) return "dotted";
  if (name.endsWith(extension)) return "bare";
  return "none";
}
const hide = (x) => [x][JSON.parse("0")];
let seen = "";
for (let i = 0; i < 300; i++) seen = kind(hide("notes"), hide("es")) + "," + kind(hide("a.es"), hide("es")) + "," + kind(hide("a.ts"), hide("es"));
console.log(seen);
