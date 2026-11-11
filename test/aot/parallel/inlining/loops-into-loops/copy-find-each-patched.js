class Writer {
  constructor() { this.out = new Uint8Array(64); this.n = 0; this.hold = 0; this.bits = 0; this.list = [5, 1, 2]; this.text = "  a   b  "; this.at = 0; }
  find(x) { for (let k = 0; k < this.list.length; k++) if (this.list[k] === x) return k; return -1; }
}

function walk(w, n) {
  let seen = "";
  [...Array(n).keys()].forEach(i => { seen += w.find(i); });
  return seen + "/" + w.n + "/" + w.bits + "/" + w.at + "/" + Array.from(w.out).slice(0, 12).join();
}
for (const n of [0, 1, 5, 20]) {
  let said;
  const w = new Writer();
  if (n === 5) w.find = function () { return 100; };
  try { said = walk(w, n); } catch (e) { said = e.constructor.name + " " + e.message; }
  console.log(n, said);
}
