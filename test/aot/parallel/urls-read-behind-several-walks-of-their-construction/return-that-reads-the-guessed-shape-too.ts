interface Box { limit: number }
interface Holder { box: Box }
const unseen = (0, eval)("(x) => x");
function shape(text: string, holder: Holder, count: number): string {
  const box = holder.box;
  for (let i = 0; i < count; i++) {
    const u = new URL(text, "http://127.0.0.1");
    if (i >= box.limit) return u.search + u.pathname + box.limit;
  }
  return "";
}
const holder: Holder = { box: { limit: 1 } };
let total = 0;
for (let turn = 0; turn < 300; turn++) total += shape(unseen("/two/three?q=1"), unseen(holder), unseen(3)).length;
console.log(total);
