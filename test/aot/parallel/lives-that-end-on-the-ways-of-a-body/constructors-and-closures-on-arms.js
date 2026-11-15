class Base { constructor(a) { if (a & 1) this.a = a; else this.a = -a; } }
class Derived extends Base { constructor(a, b) { super(a); if (b) { this.b = { lid: b }; } else { this.b = null; } } }
function Old(a) { if (!(this instanceof Old)) return new Old(a); if (a & 1) { this.a = a; } else { this.a = 0; } }
function makes(i) {
  const box = { lid: i };
  let read;
  if (i & 1) read = () => box.lid; else read = () => box.lid + 1;
  let n = 0;
  for (let k = 0; k < 2; k++) { const step = () => k + box.lid; if (k) n += step(); else n += read(); }
  return n;
}
function tail(i) { const o = { lid: i }; return i > 0 ? tail2(o, i - 1) : o.lid; }
function tail2(o, i) { const p = { lid: o.lid + 1 }; if (i & 1) return tail(p.lid - 1 > 3 ? 3 : i); return p.lid; }
function drive() { let sum = 0; for (let t = 0; t < 12; t++) { const d = new Derived(t, t & 2); sum += d.a + (d.b ? d.b.lid : 1) + Old(t).a + new Old(t).a + makes(t) + tail(t); } return sum; }
console.log(drive());
