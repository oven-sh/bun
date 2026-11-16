const unseen = (x) => [x][JSON.parse("0")];
function store(m, k, v) { m.set(k, v); }
function storeIn(s, v) { s.add(v); }
function once(turn) {
  const map = new Map(), set = new Set();
  for (let i = 0; i < 4; i++) { map.set("k" + i, i * 2); set.add(i * 3); }
  if (turn === 299) { set.add("text"); }
  let t = ""; for (const v of set) t += typeof v + ":" + String(v + 1) + ";";
  return t;
}
let last = "", first = "";
for (let turn = 0; turn < 300; turn++) { last = once(turn); if (!turn) first = last; }
console.log(first, "|", last);
