"use strict";
class Crate { constructor(n) { this.weight = n + 1; } }
class Sealed extends Crate { constructor(n) { super(n); Object.defineProperty(this, "seal", { value: n + 2 }); } }
function fill(count) { const rows = []; for (let i = 0; i < count; i++) rows.push(new Sealed(i)); return rows; }
function total(rows) { let sum = 0; for (let i = 0; i < rows.length; i++) sum += rows[i].seal + rows[i].weight; return sum; }
const rows = fill(20000);
const found = Object.getOwnPropertyDescriptor(rows[1], "seal");
console.log(total(rows), Object.keys(rows[1]).join(), rows[1].seal, found.writable, found.enumerable, found.configurable);
