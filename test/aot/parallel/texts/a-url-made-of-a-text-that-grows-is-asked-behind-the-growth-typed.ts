const unseen = (0, eval)("(x) => x") as <T>(x: T) => T;
function gather(count: number): string {
  const kept: unknown[] = [];
  let line = "http://a.example/p?a=0";
  for (let i = 0; i < count; i++) {
    const url = new URL(line);
    line += "&k" + i + "=%2" + i;
    kept.push(url.searchParams.get("k0"), url.searchParams.has("k1"), url.pathname, url.search);
  }
  return line + "/" + kept.join("|");
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = gather(unseen(3));
console.log(last);
console.log(gather(unseen(5)));
