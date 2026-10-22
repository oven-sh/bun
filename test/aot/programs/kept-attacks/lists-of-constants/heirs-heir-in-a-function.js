// Lists of constants: heirs heir in a function. It prints what plain Bun prints.
function Meter(name) {
  this.name = name;
  this.count = 0;
  this.total = 0;
}
Meter.prototype.add = function (n) { this.count++; this.total += n; return this; };
function Plain(name) { Meter.call(this, name); this.plain = true; }
Object.setPrototypeOf(Plain.prototype, Meter.prototype);
function Other(name) { Meter.call(this, name); this.other = 1; }
Object.setPrototypeOf(Other.prototype, Meter.prototype);
let Lazy;
function getLazy() {
  if (Lazy) return Lazy;
  Lazy = class Lazy extends Meter { extra = 1; constructor(name) { super(name); } };
  return Lazy;
}
let sum = 0;
for (let i = 0; i < 200000; i++) {
  const a = new Plain("a"), b = new Other("b"), c = new Meter("c");
  sum += a.add(i).total + b.add(1).count + c.add(2).total;
  if (process.argv[2] === "lazy" && (i & 1023) === 0) sum += new (getLazy())("l").add(3).total;
}
console.log(sum);
