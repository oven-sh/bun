function relation(path, dir) {
  if (path.startsWith(dir + "/")) return "inside";
  if (path.startsWith(dir)) return "beside";
  return "outside";
}
const hide = (0, eval)("(x) => x");
let seen = "";
for (let i = 0; i < 300; i++) seen = relation(String(hide("src2/a")), String(hide("src"))) + "," + relation(String(hide("src/a")), String(hide("src"))) + "," + relation(String(hide("lib/a")), String(hide("src")));
console.log(seen);
