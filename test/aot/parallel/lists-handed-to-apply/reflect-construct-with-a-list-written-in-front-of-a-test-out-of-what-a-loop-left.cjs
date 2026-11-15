// A construction by Reflect.construct takes a list that is written in front of a test out of what a loop read last.
class Pair { constructor(one, two) { this.text = one + two; } }
const shown = new Proxy(Pair, { construct(target, list) { return { text: "shown:" + list.length + ":" + list.join("|") }; } });
const rows = JSON.parse('[["a"],["b","c"],["d","e","f"]]');
function make(all, target) {
  const out = [];
  for (let r = 0; r < all.length; r++) {
    const row = all[r];
    let last = "";
    for (let i = 0; i < row.length; i++) last = row[i];
    const list = [last, "x"];
    if (row.length > 1) out.push(Reflect.construct(target, list).text);
  }
  return out.join();
}
globalThis.handed = [make];
for (const target of [Pair, shown, Math.max]) {
  try { console.log(make(rows, target)); } catch (error) { console.log(error.constructor.name); }
}
