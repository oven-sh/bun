const unseen = (x) => [x][JSON.parse("0")];
function make() { const map = new Map(); for (let i = 0; i < 6; i++) map.set("k" + i, i * 2); return map; }
function makeSet() { const set = new Set(); for (let i = 0; i < 6; i++) set.add(i * 3); return set; }
function once(turn) {
  const map = make(), set = makeSet(), out = [];
  let n = 0; for (const [k, v] of map) { if (n++ < 3) { map.delete(k); map.set(k, v + 1); } out.push(k, v); }
  return out.join();
}
let last = "";
for (let turn = 0; turn < 300; turn++) last = once(turn);
console.log(last);
