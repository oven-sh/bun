const unseen = (x) => [x][JSON.parse("0")];
function once(turn) {
  const m = new Map(); m.set(-0, "x"); let t = ""; for (const [k, v] of m) t += String(Object.is(k, 0)) + String(1 / k) + v; t += String(m.get(0)) + String(m.get(-0));
  return t;
}
let last = "", first = "";
for (let turn = 0; turn < 300; turn++) { last = once(turn); if (!turn) first = last; }
console.log(first, "|", last);
