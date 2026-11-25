const hide = (x) => [x][JSON.parse("0")];
const paths = hide(["src2/a", "src/a", "lib/a"]);
const dir = String(hide("src"));
let seen = "";
for (let i = 0; i < paths.length; i++) {
  const path = String(paths[i]);
  if (path.startsWith(dir + "/")) seen += "inside,";
  else if (path.startsWith(dir)) seen += "beside,";
  else seen += "outside,";
}
console.log(seen);
