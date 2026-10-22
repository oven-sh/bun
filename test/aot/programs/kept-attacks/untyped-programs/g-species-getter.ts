// Untyped programs: g species getter. It prints what plain Bun prints.
let changes = 0;
function change() { changes++; }
class Other extends Array { static get [Symbol.species]() { change(); return Array; } }
const other: any = new Other(); other.push(1);
console.log(other.map((x: any) => x).length, changes);
