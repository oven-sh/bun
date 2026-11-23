class Writer {
  constructor() { this.out = new Uint8Array(64); this.n = 0; this.hold = 0; this.bits = 0; this.list = [5, 1, 2]; this.text = "  a   b  "; this.at = 0; }
  stop(x) { for (let k = 0; k < x; k++) if (k === 3) throw new RangeError('at ' + k); return x; }
}

function walk(w, n) {
  let seen = "";
  for (let i = 0; i < n; i++) { try { seen += w.stop(i % 6); } catch (e) { seen += e.message; } }
  return seen + "/" + w.n + "/" + w.bits + "/" + w.at + "/" + Array.from(w.out).slice(0, 12).join();
}
for (const n of [0, 1, 5, 20]) {
  let said;
  const w = new Writer();
  
  try { said = walk(w, n); } catch (e) { said = e.constructor.name + " " + e.message; }
  console.log(n, said);
}
