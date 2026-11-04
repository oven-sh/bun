// the method throws
class Meter { read(x) { if (x > 1) throw new RangeError("too much " + x); return x; } }
let count = 0;
function once(m, x) { try { return m.read(x); } catch (e) { return e.constructor.name + " " + e.message; } finally { count++; } }
const m = new Meter(); globalThis.kept = m;
console.log(once(m, 1), "|", once(m, 2), "|", count);
