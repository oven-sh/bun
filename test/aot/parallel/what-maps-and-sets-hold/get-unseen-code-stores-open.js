const unseen = (0, eval)("(x) => x");
function store(m, k, v) { m.set(k, v); }
function storeIn(s, v) { s.add(v); }
function once(turn) {
  const map = new Map(), set = new Set();
  for (let i = 0; i < 4; i++) { map.set("k" + i, i * 2); set.add(i * 3); }
  if (turn === 299) { unseen((m) => m.set("odd", "text"))(map); }
  let t = ""; for (let i = 0; i < 5; i++) { const v = map.get("k" + i); t += typeof v + ":" + String(v && v.length !== undefined ? v.length : v) + ";"; } t += typeof map.get("odd") + String(map.get("odd"));
  return t;
}
let last = "", first = "";
for (let turn = 0; turn < 300; turn++) { last = once(turn); if (!turn) first = last; }
console.log(first, "|", last);
