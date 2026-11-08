function relation(a, b) {
  const path = String(a), dir = String(b);
  if (path.startsWith(dir + "/")) return "inside";
  if (path.startsWith(dir)) return "beside";
  return "outside";
}
const hide = (x) => [x][JSON.parse("0")];
let seen = "";
for (let i = 0; i < 300; i++) seen = relation(hide("src2/a"), hide("src")) + "," + relation(hide("src/a"), hide("src")) + "," + relation(hide("lib/a"), hide("src")) + "," + relation(hide("src"), hide("src"));
console.log(seen);
