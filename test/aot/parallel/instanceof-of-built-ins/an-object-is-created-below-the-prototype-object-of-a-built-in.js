// Object.create lays an ordinary object below the prototype object of Map, of Array and of Error: each is an instance by `instanceof`, and none has the cell of its class.
function isMap(x) { return x instanceof Map; }
function isArray(x) { return x instanceof Array; }
function isError(x) { return x instanceof Error; }
function countMaps(x, n) { let s = 0; for (let i = 0; i < n; i++) { if (x instanceof Map) s++; } return s; }
function createdIsMap() { const created = Object.create(Map.prototype); return created instanceof Map; }
function createdIsObject() { const created = Object.create(null); return created instanceof Object; }

function deed(above) {
  return Object.create(above);
}
console.log(String(isMap(deed(Map.prototype))), String(isArray(deed(Array.prototype))), String(isError(deed(Error.prototype))), String(isError(deed(TypeError.prototype))), String(countMaps(deed(Map.prototype), 100)));
console.log(String(Array.isArray(deed(Array.prototype))), String(isMap(Map.prototype)), String(isArray(Array.prototype)), String(isError(Error.prototype)));
console.log(String(createdIsMap()), String(createdIsObject()));
try { deed(Map.prototype).get(1); } catch (error) { console.log(error.name); }
let count = 0;
for (let i = 0; i < 200; i++) count += (isMap(i & 1 ? new Map() : deed(Map.prototype)) ? 1 : 0) + (isArray(i & 1 ? [] : deed(Array.prototype)) ? 1 : 0) + (isError(i & 1 ? {} : deed(RangeError.prototype)) ? 1 : 0) + (createdIsMap() ? 10 : 0) + (createdIsObject() ? 100 : 0);
console.log(String(count));
