// Species: programs claim. It prints what plain Bun prints.
let change: () => void = () => {};
class Other extends Array { static get [Symbol.species]() { change(); return Array; } }
try { const other: any = new Other(); other.push(1); console.log('made', other.length); console.log(other.map((x: any) => x).length); } catch (e) { console.log('threw', String(e)); }
