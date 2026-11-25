function relation(a, b) {
  const path = String(a), dir = String(b);
  if (path.startsWith(dir + "/")) return "inside";
  if (path.startsWith(dir)) return "beside";
  return "outside";
}
const hide = (x) => [x][JSON.parse("0")];
console.log(relation(hide("src2/a"), hide("src")));
console.log(relation(hide("src/a"), hide("src")));
