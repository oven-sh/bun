// push() and shift() of a ring are copied into the loop; shift() stands behind an `if`. Each stores into the list and into fields of the ring: a copy of the loop that keeps other code out of its turns would be left at the first store.
class Ring { constructor(cap) { this.cap = cap; this.buf = new Array(cap).fill(null); this.head = 0; this.tail = 0; this.size = 0; }
  push(x) { if (this.size === this.cap) return false; this.buf[this.tail] = x; this.tail = (this.tail + 1) & (this.cap - 1); this.size++; return true; }
  shift() { if (this.size === 0) return undefined; const x = this.buf[this.head]; this.buf[this.head] = null; this.head = (this.head + 1) & (this.cap - 1); this.size--; return x; } }
const ring = new Ring(JSON.parse("16"));
function f(t) { let s = 0; for (let i = 0; i < 64; i++) { ring.push(i + t & 7); if (i & 1) s += ring.shift() + ring.shift(); } while (ring.size) ring.shift(); return s; }
const rounds = JSON.parse("4");
for (let t = 0; t < rounds; t++) console.log(f(t), ring.head, ring.tail, ring.size);
