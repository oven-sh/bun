const unseen = (0, eval)("(x) => x");
async function loadLate(text) { await null; return text + "?"; }
const show = (value) => Array.isArray(value) ? "[" + value.map(show).join(",") + "]" : String(value);

async function gather(count, tail) {
  const pending = [];
  let line = "";
  for (let i = 0; i < count; i++) {
    pending.push(Promise.all([loadLate(tail), loadLate(line), line]));
    line += "k" + i;
    
  }
  pending.push(line);
  return pending;
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = show(await Promise.all(await gather(unseen(3), unseen("-"))));
console.log(last);
console.log(show(await Promise.all(await gather(unseen(0), unseen("")))));
console.log(show(await Promise.all(await gather(unseen(5), unseen("k1")))));
