// %2 and a digit has to be decoded, so the object is made after all: of the text as it was when `new URL` stood there.
const unseen = (0, eval)("(x) => x");
function gather(count) {
  const kept = [];
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
