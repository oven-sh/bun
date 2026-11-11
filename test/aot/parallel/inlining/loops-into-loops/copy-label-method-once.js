class Writer {
  constructor() { this.out = new Uint8Array(64); this.n = 0; this.hold = 0; this.bits = 0; this.list = [5, 1, 2]; this.text = "  a   b  "; this.at = 0; }
  label(n) { let s = 0; outer: for (let k = 0; k < n; k++) { if (k % 2) continue outer; s += k; } return s; }
}

function walk(w, n) {
  let seen = "";
  const again = { run(i) { seen += w.label(i); } }; for (let i = 0; i < n; i++) again.run(i);
  return seen + "/" + w.n + "/" + w.bits + "/" + w.at + "/" + Array.from(w.out).slice(0, 12).join();
}
for (const n of [0, 1, 5, 20]) {
  let said;
  const w = new Writer();
  
  try { said = walk(w, n); } catch (e) { said = e.constructor.name + " " + e.message; }
  console.log(n, said);
}
