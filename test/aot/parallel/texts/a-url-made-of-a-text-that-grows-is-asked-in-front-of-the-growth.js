const unseen = (0, eval)("(x) => x");
function gather(count) {
  const kept = [];
  let line = "http://a.example/p?a=0";
  for (let i = 0; i < count; i++) {
    const url = new URL(line);
    kept.push(url.searchParams.get("k0"), url.pathname);
    line += "&k" + i + "=%2" + i;
  }
  return line + "/" + kept.join("|");
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = gather(unseen(3));
console.log(last);
console.log(gather(unseen(5)));
