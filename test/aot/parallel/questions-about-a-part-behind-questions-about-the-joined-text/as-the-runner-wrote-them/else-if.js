function relation(a, b) {
  const path = String(a), dir = String(b);
  let answer = "outside";
  if (path.startsWith(dir + "/")) answer = "inside";
  else if (path.startsWith(dir)) answer = "beside";
  return answer;
}
const hide = (x) => [x][JSON.parse("0")];
let seen = "";
for (let i = 0; i < 300; i++) seen = relation(hide("src2/a"), hide("src")) + "," + relation(hide("src/a"), hide("src")) + "," + relation(hide("lib/a"), hide("src"));
console.log(seen);
