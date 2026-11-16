"use strict";
class Crate { constructor(n) { this.weight = n + 1; } }
class Barrel { constructor(n) { this.volume = n * 2; this.hoops = 3; } }
class Sealed extends Crate { constructor(n) { super(n); this.seal = n + 2; } }
function fill(count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    if (i === 700) Object.setPrototypeOf(Sealed, Barrel);
    rows.push(new Sealed(i));
  }
  return rows;
}
const rows = fill(1500);
let weights = 0, volumes = 0, seals = 0;
for (const row of rows) { weights += row.weight ?? 0; volumes += row.volume ?? 0; seals += row.seal; }
console.log(weights, volumes, seals, Object.keys(rows[699]).join(), Object.keys(rows[700]).join(), rows[700] instanceof Sealed, rows[700] instanceof Crate, rows[700] instanceof Barrel);
