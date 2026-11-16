"use strict";
class Crate { constructor(n) { this.weight = n + 1; } }
class Barrel { constructor(n) { this.volume = n * 2; } }
class Sealed extends Crate { constructor(n) { super(n); this.seal = new.target.name; } }
class Stamped extends Sealed { constructor(n) { super(n); Object.defineProperty(this, "stamp", { value: n + 3, enumerable: true }); } }
function fill(count) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    if (i === 400) Object.setPrototypeOf(Sealed, Barrel);
    if (i === 800) Object.setPrototypeOf(Stamped, Crate);
    rows.push(new Stamped(i));
  }
  return rows;
}
const rows = fill(1200);
let stamps = 0;
for (const row of rows) stamps += row.stamp;
console.log(stamps, Object.keys(rows[399]).join(), Object.keys(rows[400]).join(), Object.keys(rows[800]).join(), rows[0].seal, rows[500].seal, rows[900].seal, rows[900] instanceof Stamped);
