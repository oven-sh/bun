const unseen = (0, eval)("(x) => x");
function gather(count) {
  const kept = [];
  let line = "http://a.example/";
  for (let i = 0; i < count; i++) {
    const url = new URL("q?x=%20y", line);
    line += "k" + i + "/";
    kept.push(url.pathname, url.searchParams.get("x"));
  }
  return line + "/" + kept.join("|");
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = gather(unseen(3));
console.log(last);
console.log(gather(unseen(5)));
