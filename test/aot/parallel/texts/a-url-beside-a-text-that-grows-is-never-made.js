// The address is no text in a builder: its URL is still answered out of the text.
const unseen = (0, eval)("(x) => x");
function gather(count, address) {
  const kept = [];
  let line = "";
  for (let i = 0; i < count; i++) {
    const url = new URL("" + address);
    line += "k" + i;
    kept.push(url.searchParams.get("k0"), url.searchParams.get(line), url.pathname);
  }
  return line + "/" + kept.join("|");
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = gather(unseen(3), unseen("http://a.example/p?k0=1&k0k1=%20"));
console.log(last);
