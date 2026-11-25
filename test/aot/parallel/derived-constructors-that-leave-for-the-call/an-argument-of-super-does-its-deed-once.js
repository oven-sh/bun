"use strict";
let deeds = 0;
const heard = [];
function count(n) { deeds++; if (n % 500 === 0) heard.push(n); return n; }
class Crate { constructor(n) { this.weight = n + 1; } }
class Barrel { constructor(n) { this.volume = n * 2; } }
class Sealed extends Crate { constructor(n) { super(count(n)); this.seal = n + 2; } }
class Stored extends Crate { constructor(n, log) { log.last = n; log.times++; super(n); this.seal = n; } }
function fill(amount) {
  const rows = [];
  const log = { last: -1, times: 0 };
  for (let i = 0; i < amount; i++) {
    if (i === 600) { Object.setPrototypeOf(Sealed, Barrel); Object.setPrototypeOf(Stored, Barrel); }
    rows.push(new Sealed(i), new Stored(i, log));
  }
  return [rows, log];
}
const [rows, log] = fill(1200);
console.log(deeds, heard.join(), log.times, log.last, rows.length, Object.keys(rows[1198]).join(), Object.keys(rows[1201]).join());
