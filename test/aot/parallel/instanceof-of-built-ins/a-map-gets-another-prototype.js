// A map is laid below another object by Object.setPrototypeOf, in the middle of a loop that asks whether it is an instance of Map.
function isMap(x) { return x instanceof Map; }
function countWhileMoved(x, n, at, above) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i === at) Object.setPrototypeOf(x, above);
    if (x instanceof Map) s++;
  }
  return s;
}

function deed(above) {
  const map = new Map();
  Object.setPrototypeOf(map, above);
  return map;
}
console.log(String(isMap(new Map())), String(isMap(deed(null))), String(isMap(deed(Object.prototype))), String(isMap(deed(Object.create(Map.prototype)))), String(isMap(deed(Map.prototype))));
console.log(String(countWhileMoved(new Map(), 100, 40, null)), String(countWhileMoved(new Map(), 100, 40, Set.prototype)), String(countWhileMoved(deed(null), 100, 40, Map.prototype)), String(countWhileMoved(new Map(), 100, 200, null)));
let count = 0;
for (let i = 0; i < 200; i++) count += isMap(i % 3 ? new Map() : deed(i % 2 ? null : Array.prototype)) ? 1 : 0;
console.log(String(count));
