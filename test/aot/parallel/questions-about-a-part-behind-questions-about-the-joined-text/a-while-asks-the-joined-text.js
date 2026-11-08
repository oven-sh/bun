function relation(a, b) {
  let path = String(a); const dir = String(b);
  let steps = 0;
  while (path.startsWith(dir + "/")) { path = path.slice(dir.length + 1); steps++; }
  return steps + ":" + path.startsWith(dir);
}
const hide = (x) => [x][JSON.parse("0")];
let seen = "";
for (let i = 0; i < 300; i++) seen = relation(hide("src/src/src2"), hide("src")) + "," + relation(hide("src/a"), hide("src")) + "," + relation(hide("src2"), hide("src")) + "," + relation(hide("lib"), hide("src"));
console.log(seen);
