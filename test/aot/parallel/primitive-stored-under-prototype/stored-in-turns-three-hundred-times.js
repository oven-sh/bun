function Meter() { this.n = 1; }
const kept = Meter.prototype;
let nulls = 0, objects = 0, below = 0;
for (let i = 0; i < 300; i++) {
  Meter.prototype = i % 2 ? null : kept;
  if (Meter.prototype === null) nulls++; else objects++;
  if (Object.getPrototypeOf(new Meter()) === kept) below++;
}
console.log(nulls, objects, below);
