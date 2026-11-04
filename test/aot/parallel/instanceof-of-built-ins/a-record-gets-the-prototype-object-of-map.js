// The object of a literal, which stands below Object.prototype as it is made, is laid below the prototype object of Map: from then on it is an instance of Map.
function make(a) { return { a }; }
function isMap(x) { return x instanceof Map; }
function madeIsMap(a, move) { const record = make(a); if (move) Object.setPrototypeOf(record, Map.prototype); return record instanceof Map; }
function madeIsObject(a, move) { const record = make(a); if (move) Object.setPrototypeOf(record, null); return record instanceof Object; }

function deed(record) {
  Object.setPrototypeOf(record, Map.prototype);
  return record;
}
console.log(String(isMap(make(1))), String(madeIsMap(1, false)), String(madeIsObject(1, false)));
let count = 0;
for (let i = 0; i < 200; i++) count += (madeIsMap(i, false) ? 1 : 0) + (madeIsObject(i, false) ? 1 : 0);
console.log(String(count));
console.log(String(isMap(deed(make(2)))), String(madeIsMap(2, true)), String(madeIsObject(2, true)), String(isMap(make(3))));
count = 0;
for (let i = 0; i < 200; i++) count += (madeIsMap(i, i % 3 === 0) ? 1 : 0) + (madeIsObject(i, i % 5 === 0) ? 1 : 0);
console.log(String(count));
console.log(String(isMap({ __proto__: Map.prototype, a: 1 })), String({ __proto__: null, a: 1 } instanceof Object));
