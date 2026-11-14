class Writer {
  constructor() { this.out = new Uint8Array(64); this.n = 0; this.hold = 0; this.bits = 0; this.list = [5, 1, 2]; this.text = "  a   b  "; this.at = 0; }
  put(v, n) { this.hold |= v << this.bits; this.bits += n; while (this.bits >= 8) { this.out[this.n++] = this.hold & 255; this.hold >>>= 8; this.bits -= 8; } }
}

function walk(w, n) {
  let seen = "";
  for (let i = 0; i < n; i++) { w.put(i & 7, 3); }
  return seen + "/" + w.n + "/" + w.bits + "/" + w.at + "/" + Array.from(w.out).slice(0, 12).join();
}
for (const n of [0, 1, 5, 20]) {
  let said;
  const w = new Writer();
  
  try { said = walk(w, n); } catch (e) { said = e.constructor.name + " " + e.message; }
  console.log(n, said);
}
