class Base { constructor(i) { this.lid = i; this.note(); } note() { for (let k = 0; k < 1; k++) this.seen = true; } }
class Below extends Base { constructor(i) { super(i); this.spout = { v: i }; } }
function Old(i) { this.lid = i; for (let k = 0; k < 1; k++) this.more = [i]; }
const a = new Base(1), b = new Below(2), c = new Old(3);
console.log(a.lid, a.seen, b.lid, b.spout.v, c.lid, c.more[0]);
