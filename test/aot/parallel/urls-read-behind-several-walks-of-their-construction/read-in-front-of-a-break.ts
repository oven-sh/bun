const unseen = (0, eval)("(x) => x");
function shape(text: string, count: number): string {
  let found = "";
  for (let i = unseen(0); i < count; i = i + 1) {
    const u = new URL(text, "http://127.0.0.1");
    if (i >= 1) { found = u.pathname; break; }
  }
  return found;
}
let total = 0;
for (let turn = 0; turn < 300; turn++) total += shape(unseen("/two/three?q=1"), 3).length;
console.log(total);
