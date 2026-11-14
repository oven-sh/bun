function Odd(i) { this.lid = i; const other = { lid: -i }; if (i & 1) return other; }
const a = new Odd(1), b = new Odd(2);
console.log(a.lid, b.lid, a instanceof Odd, b instanceof Odd);
