class Item {
  next = null;
  constructor(val) { this.val = val; }
  get2() { return this.val * 2; }
}
const args = process.argv.slice(2);
const sel = Number(args[0] ?? 0);
const x = Number(args[1] ?? 5) | 0;
const y = Number(args[2] ?? 6) | 0;
const a = new Item(1), b = new Item(2);
a.next = new Item(3);
b.next = new Item(7);
function pick() {
  if (!x || !y || !a.next || !b.next) return -2;
  const c = (sel & 1) !== 0 ? (sel & 2) !== 0 : (sel & 4) !== 0;
  const v = c ? a : b, w = c ? x : y;
  if (w && v.next) { v.next.val = 100; return a.next.val + ":" + b.next.val; }
  return -1;
}
console.log(pick());
