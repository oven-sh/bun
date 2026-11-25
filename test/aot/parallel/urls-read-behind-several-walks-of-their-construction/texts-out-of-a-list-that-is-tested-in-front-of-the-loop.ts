const unseen = (0, eval)("(x) => x");
function shape(texts: string[]): string {
  for (let i = 0; i < texts.length; i++) {
    const u = new URL(texts[i], "http://127.0.0.1");
    if (i === texts.length - 1) return u.search + u.pathname;
  }
  return "";
}
let total = 0;
for (let turn = 0; turn < 300; turn++) total += shape(unseen(["/a", "/two/three?q=1"])).length;
console.log(total, shape(unseen(["/four?r=2"])), shape(unseen([])));
